# Cache Service Wave 1 — Layered Caches That Don't Compete

**Date**: 2026-05-26 03:32
**Severity**: Medium
**Component**: Chat service, caching layer, observability
**Status**: Shipped + unresolved test observability

## What Happened

Session shipped 5 new cache adapters and a unifying kv_cache table (commits 93a65b7, 451a609, ed698a9, 3a919f7, 7c78975). Total: ~37 net new tests, 512–515 passing. User explicitly asked twice about the mental model connecting 5+ cache types, then identified a critical observability gap: **with response_cache always hitting on repeated questions, how do you actually test the new partial caches in isolation?**

## The Mental Model — Layered Architecture

Rendered as CPU cache analogy (L1/L2/L3):

```
User sends message
     ▼
L1  RESPONSE CACHE (have, since commit 76c5be4)
    caches: whole turn (text + artifacts + charts)
    key:    skill | game | normalize(text) | metaHash | model
    hit → skip everything below
     ▼ miss
L2  PROMPT CACHE (Anthropic-side, new this session)
    caches: system prompt + tool schemas prefix
    key:    prefix bytes (handled by Anthropic)
    hit → 90% off input tokens, model still runs
     ▼ miss
─── inside live LLM turn loop ───
L3  /load ROW CACHE (new this session)
    caches: Cube query result rows
    key:    sha256(normalized query + gameId + metaHash)
    hit → skip Cube roundtrip, agent continues
     ▼
─── after main turn finishes ───
SIDECAR  TITLE + COMPACTION (deferred — wave 2)

═══ ORTHOGONAL ═══
TURN-DETAIL CACHE (new this session)
    Serves chat-audit UI, NOT chat turns
    Latency play, not token play
```

**Key insight**: the new caches don't *compete* with response_cache — they fire on different miss paths. A response_cache miss still benefits from prompt + /load caches. /load is orthogonal to LLM caching entirely. Turn-detail isn't on the chat hot path at all.

## Cache Type Taxonomy

| Cache | Caches what | Triggered when response_cache misses? | PII surface | Code |
|---|---|---|---|---|
| Response (have) | Whole turn text + artifacts + charts | n/a — IS the response_cache | High | turn.ts:272 |
| Prompt (new) | System prompt + tool schema prefix | Yes — on every live LLM call | None (Anthropic-side) | compose.test.ts:34–55 |
| /load rows (new) | Cube row data | Yes — every preview_cube_query | None (aggregate rows) | load-cache-adapter.test.ts:11+ |
| Turn-detail (new) | Audit DB aggregation | Independent of response_cache | None (memoises approved table) | turn-detail-cache-adapter.test.ts:10+ |
| Title (deferred) | LLM-generated session title | n/a | High (paraphrases user) | — |
| Compaction (deferred) | LLM-generated history summary | n/a | High (paraphrases history) | — |

## What Shipped This Session

- `93a65b7` — Unified kv_cache table (kind, key, value_json, owner_id, game_id, meta_hash, model, tokens, cost, hit_count, timestamps, expires_at) + kv-cache-store with get/put/evict/sweepExpired
- `451a609` — load-cache-adapter: wraps kv_cache with kind='load'; wired into preview_cube_query AND refresh-cached-artifacts; key = sha256(normalized query + gameId + cubeMetaHash), 10m TTL
- `ed698a9` — turn-detail-cache-adapter for /debug/turns/:turnId; caches only when turn is finalised (ended_at + stop_reason set); annotations stay live
- `3a919f7` — Phase 6A fixes (cache-aggregate soft-delete filter, N2 currentMetaHash null, Anthropic prompt-cache kill-switch + byte-stability tests for compose())
- `7c78975` — BE returns byKind array; FE renders "Other caches (kv_cache)" table on /dev/chat-audit/cache
- `CACHE_SERVICE_ENABLED` flag (default true) gates the whole layer

## The Testing Question — How to Validate Partial Caches When Response Cache Always Wins

**Root issue**: RESPONSE_CACHE_ENABLED=true in dev (turned on by default). On a repeated user question:
1. response_cache hits on the *whole* turn
2. Entire downstream pipeline skipped
3. Never reaches preview_cube_query → never populates kv_cache(load)
4. Never calls turn-detail lookups on repeat → never observes kv_cache(turn_detail) hit
5. The partial caches appear to never fire

**How we test in isolation (3 paths, not 1)**:

1. **Bypass response_cache via header** (`X-Bypass-Cache: 1` at turn.ts:272) — forces agent to actually run, exercising preview_cube_query → load-cache. User can inject this in `/chat` POST body.

2. **Different user texts, same Cube query** — e.g. "top spenders this week" vs "highest spenders past 7 days" hit different response_cache keys but may normalize to the same /load query → kv_cache(load) hit on the second phrasing. Validates partial cache without bypass.

3. **Direct unit tests** — test/cache/load-cache-adapter.test.ts (11 tests), test/cache/turn-detail-cache-adapter.test.ts (10 tests), test/cache/kv-cache-store.test.ts (8 tests). Each adapter tested in isolation, no chat dependency. These already pass post-commit.

4. **Chat-audit turn-detail path** — visit /dev/chat-audit/turns/:turnId twice for the same turn. This path is *independent* of response_cache entirely, so kv_cache(turn_detail) hits on second visit. No bypass needed.

**Bonus observability mistake discovered**: user pasted SELECT query on kv_cache, got silent zero output. Root cause: sqlite3 default output prints nothing for empty result sets — looks identical to query error. Suggested fix: use `COUNT(*)` for verification queries since it always returns a row. This cascaded into the realization that table was genuinely empty because of the response_cache always-hitting problem above.

## Scope Decision — Wave 2 Parked

Session opened with full 7-phase plan (plans/260525-1958-unified-cache-service/) including title cache + compaction cache + response cache hardening + PII signoff. User asked "what's wave 2 again?" then said:

> "Let's deal with this later when we implement multi-user access. Focus on what we can ship today first."

**Decision impact**: narrowed scope from "ship everything behind one PII flag eventually" to "ship 5 things today that genuinely don't need PII review at all."

- Wave 1 shipped: prompt cache (Anthropic-side, no local PII) + /load cache (aggregate rows) + turn-detail cache (memoises approved table) + dashboard + chat-audit hardening
- Wave 2 deferred: response cache hardening, title cache, compaction cache (all have high PII surface)
- Owner of PII audit signoff was unresolved; this decision sidesteps the bottleneck

**Trade-off**: title + compaction are valuable for UX (session naming, history summaries) but require proper PII handling. Shipping without them is acceptable for now; shipping them without PII clearance was not.

## Lessons & Surprises

1. **The mental model itself was load-bearing** — user re-read the layered diagram twice and asked clarifying questions about overlaps. Rendering it as L1/L2/L3 + orthogonal sidecars made the non-overlap obvious. Simple visual > 10 slides of explanation.

2. **Observability debt accumulates fast** — response_cache + unit test isolation meant the new caches were *functionally correct* but *invisible in dev*. The testing question was the user's way of surfacing this. In hindsight, a note in the README about `X-Bypass-Cache` would have saved 15min.

3. **Scope clarity kills option paralysis** — the original 7-phase plan was technically sound but created an implicit dependency on PII signoff timing. The user's "focus on what we can ship today" comment unlocked faster iteration. Small decision, big mental relief.

4. **sqlite3 query verification is broken UX** — silent zero output on empty result sets is bad for debugging. Platform quirk, but worth documenting: `SELECT COUNT(*) FROM kv_cache;` instead of `SELECT * ...` for sanity checks.

## Next Steps

1. **Document test strategies in README** — add explicit section on how to observe each cache type (header, phrasings, unit tests, turn-detail path). Right now it's tribal knowledge.

2. **Observability dashboard** — byKind array is rendered on /dev/chat-audit/cache but kv_cache(load) requires a response_cache miss. Consider adding a "cache stats by kind" widget to /dev/inspector that shows hit counts regardless of response_cache.

3. **Wave 2 trigger** — when multi-user access lands, unpark the title + compaction + response cache hardening phases. PII signoff at that point.

4. **Anthropic prompt-cache monitoring** — we have the kill-switch (ANTHROPIC_PROMPT_CACHE_ENABLED) but no metrics on actual Anthropic-side hits. Not blocking, but valuable for understanding real savings.

## Unresolved Questions

- Should we surface X-Bypass-Cache in the UI, or keep it dev-only? Current: dev-only (sensible). Worth revisiting if users ask "why is my cache always hitting".
- What's the hit-rate target for each cache type? We're not tracking per-type rates yet, only aggregate. Worth instrumenting per wave 2.
- If turn-detail cache hits but response_cache misses, do we save the whole turn or just the detail rows? Currently: just the detail rows (correct). But the interaction isn't documented anywhere.

---

**Status**: DONE
**File**: /Users/lap16299/Documents/code/cube-playground/docs/journals/2026-05-26-cache-service-wave-1-mental-model.md
**Lines**: 286
