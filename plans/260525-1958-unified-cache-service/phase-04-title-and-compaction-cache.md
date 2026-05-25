# Phase 04 — Title + Compaction Sub-LLM Dedup Caches

## Context Links

- Title call site: `chat-service/src/api/turn.ts:515–559` (fire-and-forget after turn 3)
- Title builder: `chat-service/src/core/title-summariser.ts`
- Compaction call site: `chat-service/src/api/turn.ts:118–152` (pre-turn auto-compact)
- Compaction summariser: `chat-service/src/core/compact-service.ts:63–92`
- Service: `chat-service/src/cache/kv-cache-service.ts` (phase 01)

## Overview

- **Priority:** P2
- **Status:** pending
- **Description:** Two sub-LLM dedup caches that share architecture. Title cache dedupes the `summariseTitle` call across sessions with identical first-3 user messages. Compaction cache dedupes the auto-compact summary across sessions with identical last-N-turn windows. Both are owner-scoped (PII gate).

## Key Insights

- Both surfaces are **fire-and-forget LLM calls** — cache miss is silent fallback to the live call. No user-visible regression even if cache is unavailable.
- Both surfaces' output is **a short text string** — small `value_json`, no artifacts/charts.
- **PII**: title cache value carries derived intent of the user's first messages. Compaction cache value carries summary of user-asked questions. Both are sensitive. **MUST be owner-scoped at lookup time** — the kv_cache `owner_id` column is the gate.

## Requirements

### Functional
- Title cache `kind='title'`, key `sha256(owner_id + ':' + normalize(first3UserMsgs))`. TTL 24h. Lookup before `summariseTitle.callLlm` SDK call.
- Compaction cache `kind='compaction'`, key `sha256(owner_id + ':' + hash(last-N-turn-content))`. TTL 7d. Lookup before `compactSession.summariserFn` SDK call.
- Both have per-kind disable via `CACHE_KINDS_DISABLED=title,compaction`.

### Non-Functional
- Lookup wall-clock cost <2ms.
- Title cache hit replaces a ~300ms LLM call → noticeable.

## Architecture

```
turn.ts (post-turn-3) ─► summariseTitle({turns, deps:{callLlm}})
                              │
                              ├─► titleCache.lookup(owner, msgs) ─► (hit) return cached title (no LLM)
                              └─► (miss) callLlm() ─► titleCache.store(owner, msgs, title) ─► return

turn.ts (pre-turn auto-compact) ─► compactSession({summariserFn})
                                          │
                                          ├─► compactionCache.lookup(owner, turnsHash) ─► (hit) return summary
                                          └─► (miss) summariserFn(turns) ─► compactionCache.store ─► return
```

### Key Derivation

**Title:**
```
normMsgs = (turns.filter(role='user').slice(0,3).map(t => normalize(t.user_text))).join('␟')
canonical = `${owner_id}:${normMsgs}`
key = sha256(canonical).slice(0,32)
```
(`normalize` = same `normalize()` used by response-cache-key.ts — single helper, DRY.)

**Compaction:**
```
window = turns.slice(-20).map(t => `${t.role}:${t.role === 'user' ? t.user_text : t.assistant_text?.slice(0,500)}`).join('␟')
canonical = `${owner_id}:${window}`
key = sha256(canonical).slice(0,32)
```

## Related Code Files

### Create
- `chat-service/src/cache/adapters/title-cache.ts` — `lookup({db, ownerId, turns}) → title | null`, `store({db, ownerId, turns, title})`.
- `chat-service/src/cache/adapters/compaction-cache.ts` — `lookup({db, ownerId, recentTurns}) → summary | null`, `store(...)`.
- `chat-service/test/cache/title-cache.test.ts` — owner isolation + TTL + dedup.
- `chat-service/test/cache/compaction-cache.test.ts` — owner isolation + window-hash stability.

### Modify
- `chat-service/src/core/title-summariser.ts` — `summariseTitle` gains optional `cache` dep; if present, lookup before `callLlm`, store after.
- `chat-service/src/core/compact-service.ts` — `compactSession` gains optional `cache` dep; same shape.
- `chat-service/src/api/turn.ts` — pass title-cache adapter into `summariseTitle.deps.cache`; pass compaction-cache adapter into `compactSession.cache`.

### Delete
- None.

## Implementation Steps

1. **Owner-scope guard at service layer** — extend `kv-cache-service.get` to accept an optional `expectedOwnerId` param. When set, the row's `owner_id` MUST match or the function returns null. Add this NOW (phase-01 deferred it). Defense-in-depth so even if an adapter forgets to filter, the service blocks cross-owner reads.
2. **Title adapter** (`title-cache.ts`):
   - `function deriveKey(ownerId, turns)` — produces 32-char hash.
   - `async lookup({db, ownerId, turns})` — `kvCacheService.get('title', key, { expectedOwnerId: ownerId })`; return parsed `value_json.title` or null.
   - `async store({db, ownerId, turns, title})` — `kvCacheService.set('title', key, { value: {title}, owner_id: ownerId, expires_at: now + 24*3600_000 })`.
3. **Compaction adapter** (`compaction-cache.ts`) — same shape, TTL = 7d, value = `{summary}`.
4. **Title integration** in `title-summariser.ts`:
   - Add `cache?: { lookup, store }` to `TitleSummariserDeps`.
   - In `summariseTitle`: if `deps.cache`, try `lookup` first; if hit, return it (skip `callLlm`). Else call LLM as today, then `store` the result (only if non-empty title).
5. **Compaction integration** in `compact-service.ts`:
   - Add `cache?: { lookup, store }` to `CompactOpts`.
   - In `compactSession`: before `summariserFn(recentTurns)`, try `lookup`. If hit, use cached summary; else call summariser and `store`.
6. **Wire adapters in `turn.ts`**:
   - Title queueMicrotask block (~line 525): inject `cache: titleCache.bind(opts.db)` into `deps`.
   - Compact block (~line 124): inject `cache: compactionCache.bind(opts.db)` into `compactSession` opts.
   - Adapter modules export a `bind(db)` helper returning `{lookup, store}` closure to keep call sites tidy.
7. **Tests**:
   - `title-cache.test.ts`: store for ownerA, lookup with ownerA returns hit; lookup with ownerB returns null (owner isolation).
   - Same first-3 messages, two different owners → two distinct cache entries.
   - TTL expiry: insert with `expires_at = now-1` → miss.
   - `compaction-cache.test.ts`: same shape with 20-turn window.

## Todo List

- [ ] Extend kvCacheService.get with expectedOwnerId
- [ ] Create title-cache.ts adapter
- [ ] Create compaction-cache.ts adapter
- [ ] Modify title-summariser.ts (optional cache dep)
- [ ] Modify compact-service.ts (optional cache dep)
- [ ] Wire both in turn.ts
- [ ] Add normalize() reuse from response-cache-key.ts
- [ ] Write 4 tests covering owner isolation, TTL, dedup
- [ ] Manual: two sessions with identical first 3 messages → only first triggers title LLM call

## Success Criteria

- Two sessions, same owner, identical first 3 user messages → 2nd session title is set without a second `summariseTitle` LLM call (verify via test log/spy).
- Cross-owner same messages → 2 LLM calls (correct isolation).
- Compaction: same window content → second compact returns cached summary instantly.
- Tests green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Cross-owner PII leak via shared cache | Low (with guards) | HIGH | Owner-scoped key + service-layer expectedOwnerId check + per-kind disable. |
| Cached title is wrong/empty, persists for 24h | Low | Medium | Store only non-empty titles; lookup verifies non-empty before returning. |
| Compaction window definition drifts (we change "last 20" to "last 30" later) | Medium | Low | Cache key includes the canonicalised window; changing window size = different key = miss = LLM fallback. Safe. |
| LLM call returns different titles for same input (non-determinism) | High | Low | Acceptable — first title wins. Document. |

## Security Considerations

- **PII**: title-cache value contains LLM-summarised text derived from user messages. Compaction-cache value contains LLM-summarised conversation. Both owner-scoped, never cross-owner.
- `CACHE_KINDS_DISABLED=title,compaction` provides per-surface kill switch independent of global flag.
- No logging of cached value content (just keys + counts).
- `chat-service/src/db/kv-cache-store.ts` `clearForKind(db, kind, {ownerId})` is the user-facing erase path; surface via debug API (out of scope this phase — track follow-up).

## Next Steps

- Phase 06 dashboard breakdown surfaces title + compaction hits/misses.
- Follow-up: owner-erasure endpoint `DELETE /debug/cache?kind=title&owner_id=X` for GDPR-style purge.
