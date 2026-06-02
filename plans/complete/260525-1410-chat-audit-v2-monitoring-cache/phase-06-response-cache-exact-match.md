# Phase 06 — Response cache: exact-match (v1)

## Context Links
- `chat-service/src/api/turn.ts:217-332` (turn handler — cache lookup site, before claudeRunner.run)
- `chat-service/src/core/claude-runner.ts:160-188` (SDK message loop — shape we must replicate)
- `chat-service/src/core/sse-stream.ts:80-141` (mapper that produces the canonical SseEvent set — replay must match)
- `chat-service/src/core/cube-meta-cache.ts` (needs a derived version hash; currently no version exported)
- `chat-service/src/db/chat-store.ts:172-210` (appendTurn — extend with cache_hit/original_turn_id)
- `chat-service/src/db/observability-migrate.ts` (additive migration pattern to copy)
- `chat-service/src/services/scheduler.ts` (reuse for 24h sweep)
- Depends on phase 02 (stop_reason for cache-write gate) and phase 03 (additive chat_turns columns precedent)

## Overview
- Priority: P2
- Status: completed
- Skill-aware response cache scoped to a game (shared across owners with same game_id). On exact-match hit: replay cached value through SSE stream byte-identical to a live response, log a chat_turns row marked cache_hit, skip the LLM call. Off by default in tests via `RESPONSE_CACHE_ENABLED`.

## Key Insights
- **Locked decision**: cache scope is per-game (across owners). PII in user_text is a real risk surface — explicitly enumerated below.
- **Byte-identical SSE replay** is critical: the cached `value_json` must include enough to reconstruct: assistant text deltas, tool_call events (if any — but per the "don't cache" rules below, only end_turn-without-tool cases qualify on v1), and a final `result` event. Easiest path: cache the full text + the rendered tool_calls (if any) — but to keep semantics safe, we **only cache turns with NO tool calls and NO artifacts/charts**. This collapses the replay to: tokens → result.
- **Cube-meta version**: `cube-meta-cache.ts` currently has no version. Plan adds `getMetaVersion(gameId)` returning sha256 of stable subset of `/meta` (cube names + measure/dimension names + types). Cached per game with same TTL.
- **System-prompt hash**: stable string from `mode-prompts.compose()` output — sha256 of `systemPrompt`.
- **Normalization**: lowercase + collapse whitespace + strip trailing punctuation only. NO stemming, NO synonym handling — that's phase 07.
- **Test gate**: `RESPONSE_CACHE_ENABLED !== 'true'` ⇒ all cache reads/writes become no-ops. Default off.

## Requirements

Functional:
- New table `response_cache`:
  ```
  response_cache(
    key TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    skill TEXT NOT NULL,
    model TEXT NOT NULL,
    user_text_normalized TEXT NOT NULL,
    value_json TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_hit_at INTEGER,
    original_turn_id TEXT NOT NULL
  )
  ```
  Index `(game_id, last_hit_at)`.
- Additive chat_turns: `cache_hit INTEGER DEFAULT 0`, `original_turn_id TEXT`.
- Cache key = `sha256(skill + '|' + game_id + '|' + normalize(user_text) + '|' + cube_meta_hash + '|' + model + '|' + system_prompt_hash)`.
- Lookup path before `claudeRunner.run`:
  1. If `process.env.RESPONSE_CACHE_ENABLED !== 'true'` → skip.
  2. If request header `X-Bypass-Cache: 1` → skip.
  3. Compute key; SELECT FROM response_cache WHERE key = ?.
  4. On hit: call `replayCachedTurn(cached, emit)` → emits token deltas (chunked) + tool_call/result events identical to a live turn. Persist new chat_turns row with cache_hit=1, original_turn_id, input_tokens=0, output_tokens=0, cost_usd=0. UPDATE response_cache SET hit_count = hit_count + 1, last_hit_at = now. NO llm_calls/tool_invocations rows. Emit `done`. Return.
- Write path (after runner finishes, before `done`):
  - Skip if `RESPONSE_CACHE_ENABLED !== 'true'`.
  - Skip if any of: tool calls present, artifacts/charts collected, stop_reason != 'end_turn', error encountered.
  - INSERT OR IGNORE into response_cache with value_json = `{ text: assistantText, toolCalls: [] }` (toolCalls always empty given the gate above), input/output tokens, cost, original_turn_id = current turnId.
- TTL: cache entries expire 24h after `created_at` OR when their `cube_meta_hash` differs from the live hash. Implemented by: (a) sweep deletes rows older than 24h; (b) lookup re-computes cube_meta_hash and compares against the hash baked into the key — automatic miss when it changes.
- Sweep registers with scheduler `0 * * * *` (1h ticks).
- UI: `cache_hit=1` turns show a "Cache hit" badge with a link to `original_turn_id`.
- UI: chat compose page exposes a "Bypass cache" toggle that sets `X-Bypass-Cache: 1`.

Non-functional:
- Hit response < 200ms wall clock (no LLM, just DB read + emit).
- Misses add < 5ms (single SELECT).
- No new env vars beyond `RESPONSE_CACHE_ENABLED`.

## Architecture

```
turn.ts handler flow (additions in **bold**):
  validate body+headers
  acquire mutex
  emit session_created / turn_started
  persist user turn
  compose system prompt
  **compute cache key (requires cube-meta-cache.getMetaVersion + system prompt + normalize)**
  **if cache hit AND !X-Bypass-Cache AND RESPONSE_CACHE_ENABLED:**
    **replayCachedTurn(cached, emit)**
    **appendTurn(cache_hit=1, original_turn_id=cached.original_turn_id)**
    **incrementCacheHit(key)**
    **emit done; finish; return**
  else:
    run claudeRunner ...
    on success && cacheable:
      writeResponseCache(...)

response-cache module:
  computeKey(parts) → sha256 hex
  normalize(text) → trim + lowercase + collapse \s+ + strip trailing /[.,!?]+/
  computeCubeMetaHash(gameId, cubeToken) → cached in cube-meta-cache module
  computeSystemPromptHash(prompt) → sha256

replayCachedTurn(cached, emit):
  const text = cached.value.text;
  // chunk into ~80-char token deltas for visual parity
  for (const chunk of chunkText(text, 80)) emit({ type: 'token', data: { delta: chunk } });
  emit({ type: 'result', data: { text, input_tokens: 0, output_tokens: 0, cost_usd: 0 } });
```

## Related Code Files

Modify:
- `chat-service/src/db/migrate.ts` — call `migrateResponseCache(db)` + ALTER chat_turns ADD cache_hit / original_turn_id
- `chat-service/src/db/chat-store.ts` — extend AppendTurnParams + INSERT for new chat_turns columns
- `chat-service/src/api/turn.ts` — cache lookup + replay branch; cache write on success; X-Bypass-Cache header read
- `chat-service/src/core/cube-meta-cache.ts` — add `getMetaVersion(gameId, cubeToken)` returning a deterministic sha256 of the stable schema slice; cache alongside meta
- `chat-service/src/config.ts` — read `RESPONSE_CACHE_ENABLED` boolean (default false)
- `chat-service/src/api/debug.ts` — extend DebugTurn DTO with `cacheHit`, `originalTurnId`
- `src/pages/DevAudit/use-debug-api-types.ts` — same extension
- `src/pages/DevAudit/turn-detail.tsx` — render "Cache hit" badge + link
- `src/components/chat/...` — "Bypass cache" toggle on compose UI (path to be confirmed during implementation — search for the compose component)

Create:
- `chat-service/src/db/response-cache-migrate.ts` — table + index
- `chat-service/src/db/response-cache-store.ts` — `getByKey`, `insertCacheEntry`, `incrementHit`, `purgeExpired` (< 150 LOC)
- `chat-service/src/cache/response-cache-key.ts` — pure functions: `normalize`, `computeKey`, `chunkText` (< 100 LOC)
- `chat-service/src/cache/replay-cached-turn.ts` — `replayCachedTurn(cached, emit)` (< 100 LOC)
- `chat-service/src/cache/response-cache-write.ts` — `maybeWriteResponseCache(...)` gate (< 80 LOC)
- `chat-service/src/services/response-cache-sweep.ts` — 1h cron handler
- Tests:
  - `chat-service/src/cache/__tests__/key.test.ts`
  - `chat-service/src/cache/__tests__/replay.test.ts` — golden SSE event-stream comparison vs a captured live turn
  - `chat-service/src/api/__tests__/turn-cache-hit.test.ts` — integration via fastify.inject

## Implementation Steps

1. **Migration**: response-cache table + index; chat_turns gets two new columns (cache_hit, original_turn_id) via `addColumnIfMissing`.
2. **Config gate**: add `responseCacheEnabled: boolean` to config, sourced from `RESPONSE_CACHE_ENABLED === 'true'`.
3. **Key module**: pure functions. Normalize: `s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?…]+$/u, '')`. computeKey: concatenate fields with `|` separator, sha256, hex.
4. **Cube-meta version**: add `getMetaVersion(gameId, cubeToken)` to `cube-meta-cache.ts`. Builds stable subset: `JSON.stringify({ cubes: cubes.map(c => ({ name, measures: m.map(x=>({name:x.name,type:x.type})), dimensions: ... })) })` → sha256. Cache version alongside the meta entry; recomputed on TTL expiry.
5. **Lookup branch** in `turn.ts`: after composing system prompt, compute key. SELECT row. If hit and gate passes, call `replayCachedTurn`. Persist new chat_turns row with cache_hit=1. Increment hit_count. Emit done and finish.
6. **Replay helper**: `replay-cached-turn.ts`. Chunks text into ~80-char windows (preserves visual streaming). Emits token events then result event. Test against a golden capture.
7. **Write branch**: after the runner loop, before persisting the assistant turn — check `RESPONSE_CACHE_ENABLED`, no tool calls (`collectedArtifacts.length === 0 && collectedCharts.length === 0`), check stop_reason via the new chat_turns column (set by phase 02), no error. Insert.
8. **Sweep**: `response-cache-sweep.ts` — `scheduler.register('response-cache-sweep', '0 * * * *', () => purgeExpired(db, Date.now() - 24*3600*1000))`. Bounded LIMIT 500 per tick.
9. **FE**: extend DebugTurn DTO; in turn-detail.tsx render `<CacheHitBadge originalTurnId={turn.originalTurnId} />` when `turn.cacheHit`. Clicking link navigates to `/dev/chat-audit/{sessionOf(originalTurnId)}#turn-{originalTurnId}` — but we don't know session from the turn DTO yet. Easiest path: store and return `originalSessionId` too — extend response_cache schema to include it. (Adjust step 1 to add `original_session_id TEXT NOT NULL`.)
10. **Bypass UI**: chat compose page — add a small "Bypass cache" toggle (off by default) that pipes `X-Bypass-Cache: 1` header.
11. **PII redaction audit gate (PRE-SHIP)**: before flipping `RESPONSE_CACHE_ENABLED=true` in any non-dev env, run a manual audit of seeded user_text for PII patterns (emails, phone numbers, account IDs). Document an OWNER-SCOPED override env (`RESPONSE_CACHE_OWNER_SCOPED=true`) as fallback if PII risk found.

## Todo List

- [x] Migrations (table + chat_turns columns)
- [x] Config gate
- [x] Key + normalize utility + tests
- [x] cube-meta-cache.getMetaVersion
- [x] Lookup branch in turn.ts
- [x] Replay helper + golden SSE test
- [x] Write branch with all skip rules
- [x] Sweep cron registration
- [x] Debug DTO + FE badge
- [x] Bypass-cache toggle on compose UI
- [x] Integration test: hit, miss, bypass, tool-call no-cache, error no-cache
- [x] PII redaction audit doc + manual sign-off

## Success Criteria

- With `RESPONSE_CACHE_ENABLED=true`, sending the same skill+gameId+prompt twice: 2nd call < 200ms, "Cache hit" badge visible in /dev/chat-audit
- Modifying cube schema (forces meta hash change) → cache invalidates on next request
- 24h-old entries purged on sweep tick
- `X-Bypass-Cache: 1` forces fresh LLM call even on hit
- SSE wire diff between cached replay and live capture = zero (golden test passes)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| PII leaks across owners via shared per-game cache | M | H | Pre-ship redaction audit; document `RESPONSE_CACHE_OWNER_SCOPED` env override as fallback. Surface big-warning in dev-audit UI ("cache scope: per-game"). |
| Replay shape drifts from live (token chunk sizing, missing fields) | L | H | Golden SSE event-stream test compares cached vs captured live; replay shares the same `writeSseEvent` writer. |
| Cube schema change goes unnoticed → stale cached answers | L | M | `cube_meta_hash` is part of the key; any schema change ⇒ guaranteed miss. TTL 24h is the upper bound. |
| Cache write races (two turns finish ~same time) cause duplicate keys | L | L | INSERT OR IGNORE on PRIMARY KEY makes this idempotent; loser is dropped. |
| Replay's token chunking visibly stutters | L | L | 80-char window is a starting point; tunable env var if user feedback says so. YAGNI default. |
| FK from chat_turns.cache_hit=1 row to a hard-deleted original turn breaks the link | M | L | `original_turn_id` is plain TEXT (no FK) — link breakage is cosmetic; FE shows "(original deleted)" fallback. |

## Security Considerations
- Cache scope is per game across owners — this is the locked decision but the riskiest. Document in `/dev/chat-audit` banner.
- Tests must seed two owners with same game and confirm: cross-owner cache HIT is intentional (cache value returns); cross-owner METADATA (e.g. who originally produced the cached turn) is NOT exposed in the FE — `originalTurnId` is opaque to the requester.
- Replay never logs the source owner's ID into the new turn — new chat_turns row carries the *requesting* owner's session_id only.
- `X-Bypass-Cache` is unauthenticated and easy to flip — no risk; just costs a fresh LLM call.

## Next Steps
- Phase 07 builds on the same table — adds semantic columns to it.
- Future: per-owner cache scope as an env-driven override.

## Unresolved Questions
- Does the chat compose UI have a stable place for the "Bypass cache" toggle? Resolved during implementation by reading the compose component (out of scope for this plan).
