# Phase 02 — Anthropic Prompt Cache (Verify + Stabilise + Kill-Switch)

## Context Links

- Research: `research/researcher-01-anthropic-prompt-cache.md` (CRITICAL — SDK gap)
- SDK call site: `chat-service/src/core/claude-runner.ts:135–152`
- System prompt builder: `chat-service/src/core/mode-prompts.ts` (compose())
- Usage capture: `chat-service/src/api/turn.ts:433–434` (cache token fields already on `chat_turns`)

## Overview

- **Priority:** P2 (independent of kv_cache; can land in parallel with phase 01)
- **Status:** pending
- **Description:** `@anthropic-ai/claude-agent-sdk` v0.3.150 does NOT expose `cache_control` (SDK issue #89). It does, however, apply automatic prefix caching. This phase VERIFIES the auto-cache is firing, STABILISES the prefix bytes so cache hits are reliable, and adds a kill-switch nonce.

## Key Insights

- **No code change to mark blocks cacheable** — the option doesn't exist in the SDK options surface. Track #89 for future per-skill explicit breakpoints.
- Auto-caching is prefix-based. Any byte rotation in `tools` (registry serialisation order) or `systemPrompt` head invalidates the cache.
- `chat_turns.cache_creation_tokens` and `cache_read_tokens` are ALREADY captured. We just need to display them and trust them.
- SDK currently defaults to 1h TTL (issue #188) — surfaces as `ephemeral_1h_input_tokens`. We don't have a config dial; document as known behavior.

## Requirements

### Functional
- Add `config.anthropicPromptCacheEnabled` (defined in phase 01 — verify).
- Add `X-Bypass-Prompt-Cache: 1` request header. When set, prepend a random UUID to systemPrompt to force a miss for that turn (debug aid).
- When `anthropicPromptCacheEnabled = false`, prepend a per-process nonce that rotates on boot (so every boot misses once, but within a process cache still works — keeps the kill-switch lightweight).
- Stabilise `contextPreamble` serialisation: sort JSON keys when stringifying.

### Non-Functional
- Zero new SDK calls.
- No DB schema changes (token columns already exist).

## Architecture

```
turn.ts ─► compose() ─► claude-runner.run({ systemPrompt }) ─► SDK auto-cache (prefix-hash, ephemeral 1h)
              │
              └─► stabilise contextPreamble JSON order
                  prepend nonce if kill-switch off OR X-Bypass-Prompt-Cache header set
```

## Related Code Files

### Modify
- `chat-service/src/core/claude-runner.ts` — accept optional `cacheBypass: boolean` in RunParams; prepend nonce to systemPrompt if true.
- `chat-service/src/core/mode-prompts.ts` (compose()) — when stringifying `contextPreamble`, sort keys: `JSON.stringify(ctx, Object.keys(ctx).sort())`. Verify the exact line in `compose()` where preamble is interpolated.
- `chat-service/src/api/turn.ts` — read `X-Bypass-Prompt-Cache` header; pass through to `claudeRunner.run({ cacheBypass })`.
- `chat-service/src/config.ts` — add `anthropicPromptCacheEnabled` flag (covered in phase 01 if landed together; otherwise added here).

### Create
- `chat-service/test/cache/prompt-cache-prefix-stability.test.ts` — composes systemPrompt twice with same inputs (intent, game, context) and asserts byte-equality. Catches future regressions where someone adds a `Date.now()` or unsorted Map iteration to compose().

### Delete
- None.

## Implementation Steps

1. **Audit `compose()` in `mode-prompts.ts`** for any non-deterministic byte source: (a) Map/Set iteration order, (b) `Date.now()` / `Math.random()`, (c) JSON.stringify on objects without sorted keys. Read the function end-to-end, note findings inline.
2. **Stabilise contextPreamble** — wherever `body.context` (object) becomes a string, replace with `JSON.stringify(ctx, Object.keys(ctx).sort())`. If `ctx` has nested objects, use a recursive sorter (small helper).
3. **Add `cacheBypass` parameter** to `claude-runner.ts` `RunParams` (optional, default false). When true, prepend `<<nonce:${randomUUID()}>>\n` to systemPrompt before passing to SDK.
4. **Per-process nonce** (kill switch) — at module load in `claude-runner.ts`, compute `const KILL_NONCE = config.anthropicPromptCacheEnabled ? '' : <<kill:${randomUUID()}>>\n;`. Always prepend `KILL_NONCE` to systemPrompt. When the flag is on, `KILL_NONCE` is empty string = no prefix change.
5. **Wire header** in `turn.ts` (before `claudeRunner.run(...)` call):
   ```ts
   const promptCacheBypass = req.headers['x-bypass-prompt-cache'] === '1';
   ```
   Pass to `claudeRunner.run({ ..., cacheBypass: promptCacheBypass })`.
6. **Write prefix stability test** — call `compose({skill: 'analytics', game: 'rov', contextPreamble: {b:1,a:2}})` twice with `a/b` keys deliberately reordered, assert resulting `systemPrompt` byte-equality.
7. **Manual verification** (one-time): boot chat-service, issue two identical turns in same session, inspect `chat_turns.cache_creation_tokens` (turn 1 > 0) and `cache_read_tokens` (turn 2 > 0). Document expected values in test as a non-asserting reference comment.

## Todo List

- [ ] Audit `compose()` for non-determinism
- [ ] Stabilise contextPreamble (sorted JSON)
- [ ] Add `cacheBypass` to claude-runner RunParams
- [ ] Add module-level `KILL_NONCE`
- [ ] Wire `X-Bypass-Prompt-Cache` header in turn.ts
- [ ] Write prefix-stability test
- [ ] Manual end-to-end token check (notes in PR description)

## Success Criteria

- Prefix-stability test green.
- `anthropicPromptCacheEnabled=false` boot → systemPrompt prefix differs from `=true` boot.
- Header `X-Bypass-Prompt-Cache: 1` → next turn shows `cache_read_tokens = 0` even on a repeat user message (still cache_creation>0 if threshold met).
- DevAudit turn detail panel (already shows `cacheCreationTokens` / `cacheReadTokens`) reflects auto-cache activity.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Auto-cache silently misses (prefix instability) | Medium | High (no token savings) | Prefix-stability test + dashboard exposure (phase 06). |
| SDK upgrade breaks our nonce prepend (e.g. SDK starts trimming leading whitespace) | Low | Medium | Snapshot the exact prepended string and assert SDK receives it via integration test (turn-flow.integration.test.ts already exercises run()). |
| 1h TTL writes cost 2× — bigger spend if many one-off conversations | Medium | Low–Medium | Track in dashboard; if hurts, open SDK issue. Out of scope to fix locally. |

## Security Considerations

- Nonce is per-process (kill switch) or per-turn (bypass header) — no PII embedded.
- Header `X-Bypass-Prompt-Cache` is server-trusted only for debug; no auth check needed because worst case is wasted tokens, not data exposure.
- `contextPreamble` may contain user-supplied context — sorted JSON serialisation doesn't change PII surface, just ordering.

## Next Steps

- DevAudit panel (phase 06) gets a new "Prompt Cache (Anthropic)" segment that sums `cache_creation_tokens` and `cache_read_tokens` from `chat_turns` over the time window.
- Track SDK issue #89; revisit explicit per-skill breakpoints when SDK exposes them.
