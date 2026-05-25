# Phase 05 — Turn-Detail Audit Cache

## Context Links

- Endpoint: `chat-service/src/api/debug.ts:204–229` (`GET /debug/turns/:turnId`)
- Observability queries: `chat-service/src/db/observability-store.ts` (`listLlmCallsByTurn`, `listToolInvocationsByTurn`, `listPermissionDecisionsByTurn`)
- Annotations: `chat-service/src/db/annotations-store.ts` (annotations CHANGE — must not be cached)
- Service: `chat-service/src/cache/kv-cache-service.ts` (phase 01)
- Turn-delete sites: search for `chat-store` UPDATE/DELETE on `chat_turns`.

## Overview

- **Priority:** P3 (latency, not token win)
- **Status:** pending
- **Description:** Cache the `llm_calls + tool_invocations + permission_decisions` payload per turn. Immutable after write (turn data doesn't mutate), so TTL = none — eviction happens on session/turn delete only. The annotation field is fetched live every request and merged in — caching it would defeat the toggle.

## Key Insights

- The endpoint already serves immutable data (a completed turn's observability rows never change). Three SELECTs collapse to one cache lookup.
- Annotation is the ONLY mutable field — fetch live; merge after cache hit.
- Cache key = `turnId` (already UUID v4, no collision risk).
- Eviction: when a session is hard-deleted (per `hardDeletePendingSessions`), evict all its turns' cache rows. Soft-delete is NOT an eviction event (debug UI shows soft-deleted sessions).

## Requirements

### Functional
- New adapter `cache/adapters/turn-detail-cache.ts` with `lookup(turnId) → {llmCalls, toolInvocations, permissionDecisions} | null` and `store(turnId, payload)`.
- `GET /debug/turns/:turnId` (debug.ts:204) consults cache; on miss does the 3 SELECTs + stores; ALWAYS fetches annotation live and merges.
- Eviction on hard-delete: extend `hardDeletePendingSessions` (chat-store.ts:92–115) to also `clearForKind('turn_detail', { turnIds: <ids being deleted> })`.

### Non-Functional
- Endpoint latency on cache hit: ~1 SELECT (annotation) + 1 cache lookup ≈ 2ms vs ~8ms cold.

## Architecture

```
GET /debug/turns/:turnId
  ├─► turnDetailCache.lookup(turnId) ─► (hit) ─┐
  │                                            │
  │                                            ▼
  │                                       merge with live annotation ─► reply
  │
  └─► (miss) 3 SELECTs ─► turnDetailCache.store(turnId, payload) ─► merge annotation ─► reply

hardDeletePendingSessions(db, cutoffMs):
  for each session being purged:
    SELECT id FROM chat_turns WHERE session_id = ?
    turnDetailCache.evictMany(turnIds)
```

### Key Derivation

```
key = turnId (already UUID v4)
```
No hashing needed — turnId is the natural primary key for this cache.

## Related Code Files

### Create
- `chat-service/src/cache/adapters/turn-detail-cache.ts` — adapter (≤80 lines).
- `chat-service/test/cache/turn-detail-cache.test.ts` — round-trip + eviction-on-delete tests.

### Modify
- `chat-service/src/api/debug.ts` — wrap the 3 SELECTs in cache lookup; merge annotation live.
- `chat-service/src/db/chat-store.ts` — `hardDeletePendingSessions` adds `evictMany(turnIds)` call before DELETE.

### Delete
- None.

## Implementation Steps

1. **Adapter** (`turn-detail-cache.ts`):
   - `function lookup(db, turnId)` — `kvCacheService.get('turn_detail', turnId)`; parse `value_json` → `{llmCalls, toolInvocations, permissionDecisions}` or null.
   - `function store(db, turnId, payload)` — `kvCacheService.set('turn_detail', turnId, { value: payload, expires_at: null })`. (No TTL — immutable.)
   - `function evictMany(db, turnIds)` — `DELETE FROM kv_cache WHERE kind='turn_detail' AND key IN (?...)`. Add this to `kv-cache-store.ts` as `clearKeys(db, kind, keys)` since the adapter shouldn't run raw SQL.
2. **Endpoint** in `debug.ts` (line 215–227):
   ```ts
   const cached = turnDetailCache.lookup(db, req.params.turnId);
   let payload = cached;
   if (!payload) {
     payload = {
       llmCalls: obsStore.listLlmCallsByTurn(db, req.params.turnId),
       toolInvocations: obsStore.listToolInvocationsByTurn(db, req.params.turnId),
       permissionDecisions: obsStore.listPermissionDecisionsByTurn(db, req.params.turnId),
     };
     turnDetailCache.store(db, req.params.turnId, payload);
   } else {
     kvCacheService.markHit('turn_detail', req.params.turnId);
   }
   const annotationRow = annotationsStore.getAnnotation(db, req.params.turnId, ownerId);
   const annotation = annotationRow ? { ...mapAnnotation(annotationRow) } : null;
   return reply.send({ ...payload, annotation });
   ```
3. **Eviction hook** in `chat-store.ts`:
   - Before `hardDelete.run(row.id)` (~line 113), select turn ids for the session and call `turnDetailCache.evictMany(db, turnIds)`.
   - Wrap in try/catch — eviction failure must not block hard-delete.
4. **Tests**:
   - `turn-detail-cache.test.ts`:
     - Store payload, lookup returns same shape.
     - Annotation NOT in cached payload (sanity).
     - `evictMany([t1, t2])` removes both; remaining turns survive.
     - Hard-delete integration: create session+turns, soft-delete, hard-purge → cache rows for those turns are gone.

## Todo List

- [ ] Add `clearKeys` to kv-cache-store.ts
- [ ] Create turn-detail-cache.ts adapter
- [ ] Modify debug.ts endpoint to use adapter (preserve annotation live-fetch)
- [ ] Add evictMany call in hardDeletePendingSessions
- [ ] Write 4 tests including hard-delete integration
- [ ] Manual: hit endpoint twice; second is faster + cache hit count incremented

## Success Criteria

- Second GET to `/debug/turns/:turnId` skips the 3 observability SELECTs (verify via spy or query log).
- Annotation toggle still works (mutable field served live).
- Hard-purging a session removes its turns' cache rows.
- Tests green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Annotation cached by mistake | Low (test guards) | Medium | Explicit test that annotation field NEVER lands in cached payload. Adapter signature excludes it. |
| Stale data on retro-write to observability (e.g. backfill job) | Low | Low | Document: any direct UPDATE to llm_calls/tool_invocations must call `evictMany([turnId])`. No such writers exist today. |
| Hard-delete batch race with concurrent reads | Low | Low | Evict BEFORE delete → reads after eviction will repopulate from now-empty SELECTs (zero-result payload). Acceptable edge case. |

## Security Considerations

- Owner authorisation is enforced UPSTREAM of the cache lookup (debug.ts line 211–213 checks `getTurnOwnerId`). Cache lookup happens only AFTER ownership confirmed.
- `value_json` contains llm_calls / tool_invocations data — same sensitivity as the live data, no new PII surface.
- `expires_at = NULL` (no TTL) — relies on hard-delete sweep for cleanup. Document this in adapter comment.

## Next Steps

- Phase 06 dashboard shows turn-detail cache hit-rate (latency win metric).
- Future: extend eviction to manual annotation-flag updates IF we add bulk turn rewrites.
