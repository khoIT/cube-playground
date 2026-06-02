# Phase 06 — Dashboard Breakdown by Kind + N2/N4 Follow-ups

## Context Links

- Aggregator: `chat-service/src/db/cache-effectiveness-store.ts`
- SQL helpers: `chat-service/src/db/cache-effectiveness-queries.ts` (lines 18–229)
- Endpoint: `chat-service/src/api/debug-cache-effectiveness.ts`
- FE types: `src/api/cache-effectiveness-types.ts`
- FE page: `src/pages/DevAudit/cache-dashboard-page.tsx`, `cache-dashboard-hero.tsx`, `cache-tab.tsx`
- N2/N4 research: `research/researcher-02-soft-delete-semantics.md`

## Overview

- **Priority:** P2
- **Status:** pending
- **Description:** Three changes folded into one phase. (1) Add per-kind breakdown to dashboard so response/load/title/compaction/turn_detail/prompt-cache each get visibility. (2) Fix N2: `currentMetaHash` arbitrary-pick across games. (3) Fix N4: aggregates count soft-deleted sessions.

## Key Insights

- The SQL fixes (N2, N4) are independent of the kind breakdown and can ship FIRST as small commits — easier rollback if a numbers regression shows up.
- The breakdown is additive: response_cache stays the "headline" (largest cache, well-trafficked). Other kinds get a small segment control / tab inside the cache page.
- Anthropic prompt cache stats come from `chat_turns.cache_creation_tokens` and `chat_turns.cache_read_tokens` — NOT from `kv_cache`. They form their own breakdown segment.

## Requirements

### Functional
- BE: every query function in `cache-effectiveness-queries.ts` adds `cs.deleted_at IS NULL` (N4).
- BE: `queryStaleRatio` returns `currentMetaHash = null` when `gameId` is undefined (N2).
- BE: `computeCacheEffectiveness` adds a `byKind` object: `{ response: {...}, load: {...}, title: {...}, compaction: {...}, turn_detail: {...}, prompt: {...} }`. Each value is `{ hits: number, misses: number | null, dollarsSaved: number, tokensSaved: number, lastHitAt: number | null }`.
- BE: response = current behaviour (legacy `response_cache` table). load/title/compaction/turn_detail = from `kv_cache` aggregated by kind. prompt = `SUM(cache_creation_tokens + cache_read_tokens)` from `chat_turns` over the window.
- FE: `CacheEffectivenessResponse` gains `byKind` field.
- FE: cache dashboard adds a segment control `[Response · Load · Title · Compaction · Turn Detail · Prompt]` driving which kind's numbers fill the hero. Response stays default.
- FE: cache-dashboard-hero renders the same 4 stat cards but sourced from the selected kind.
- FE: When `currentMetaHash === null`, the stale chip omits the "cube meta drifted" suffix (already gated on staleRatio, so check copy stays correct).

### Non-Functional
- BE aggregate query stays under 30ms (existing scale).
- FE renders identical layout — purely a data-source swap.

## Architecture

```
debug-cache-effectiveness handler ─► computeCacheEffectiveness(db, params)
                                          ├─► existing 5 SQL helpers (response_cache, joined to chat_sessions WITH deleted_at filter)
                                          ├─► aggregateByKind(db, sinceMs, ownerId) ─► from kv_cache
                                          └─► aggregatePromptCache(db, sinceMs, ownerId) ─► from chat_turns
                                          merge into byKind: { response, load, title, ... }
```

## Related Code Files

### Modify (BE)
- `chat-service/src/db/cache-effectiveness-queries.ts` — 6 SQL functions add `cs.deleted_at IS NULL` (1-line each). Fix N2 in `queryStaleRatio`.
- `chat-service/src/db/cache-effectiveness-store.ts` — add `byKind` to result; compose with new aggregators.
- `chat-service/src/db/kv-cache-store.ts` — extend `aggregateByKind(db, params)` (from phase 01) to return `{kind, hits, dollarsSaved, tokensSaved, lastHitAt}` rows.
- `chat-service/src/db/cache-effectiveness-queries.ts` — add `queryPromptCacheTokens(db, {ownerId, sinceMs, gameId})` aggregating `chat_turns.cache_creation_tokens / cache_read_tokens`.

### Modify (FE)
- `src/api/cache-effectiveness-types.ts` — add `byKind` field to `CacheEffectivenessResponse`.
- `src/pages/DevAudit/cache-dashboard-page.tsx` — add `selectedKind` state + segment control; pass selected kind's metrics into hero.
- `src/pages/DevAudit/cache-dashboard-hero.tsx` — accept optional `byKind` prop; if present, render selected kind.

### Create
- `src/pages/DevAudit/cache-kind-segment.tsx` — segment control component (≤80 lines).
- `chat-service/test/db/cache-effectiveness-soft-delete.test.ts` — N4 regression test.
- `chat-service/test/db/cache-effectiveness-current-meta-hash.test.ts` — N2 regression test.
- `chat-service/test/db/cache-effectiveness-by-kind.test.ts` — breakdown shape test.

### Delete
- None.

## Implementation Steps

### Sub-phase 6A: N2 + N4 SQL fixes (independent, ship first)
1. In `cache-effectiveness-queries.ts`, add `AND cs.deleted_at IS NULL` (or `s.deleted_at IS NULL`) to the WHERE clause of each of the 6 SELECTs. Use the alias that matches the FROM clause:
   - `queryHitRateAndLatency` — `cs`
   - `querySavingsTotals` — `s`
   - `querySparklineByDay` — `cs`
   - `queryTopQueriesByHit` — `s`
   - `queryStaleRatio` hash query — `s`
   - `queryStaleRatio` count query — `s`
2. In `queryStaleRatio`, replace `: (hashRows[0]?.cube_meta_hash ?? null)` with `: null` so all-games scope returns no global hash.
3. Write N4 test: seed sessions A (live) + B (soft-deleted), each with one cached turn; assert `computeCacheEffectiveness` counts only A.
4. Write N2 test: seed games X (hash H1) + Y (hash H2), single owner; call with `gameId: undefined`; assert `currentMetaHash === null`.
5. Run existing cache-effectiveness tests — ensure no breakage.

### Sub-phase 6B: byKind breakdown
6. Extend `kv-cache-store.ts` with `aggregateByKind(db, {ownerId, sinceMs}) → Array<{kind, hits, dollarsSaved, tokensSaved, lastHitAt}>`. SQL: `SELECT kind, SUM(hit_count) as hits, SUM(cost_usd * hit_count) as dollars, SUM((input_tokens+output_tokens) * hit_count) as tokens, MAX(last_hit_at) FROM kv_cache WHERE owner_id = ? AND created_at >= ? GROUP BY kind`.
7. Add `queryPromptCacheTokens` in `cache-effectiveness-queries.ts`: `SELECT SUM(cache_creation_tokens) as creation, SUM(cache_read_tokens) as reads FROM chat_turns ct JOIN chat_sessions cs ON cs.id = ct.session_id WHERE cs.owner_id = ? AND cs.deleted_at IS NULL AND ct.started_at >= ? [AND cs.game_id = ?]`.
8. Compose `byKind` in `computeCacheEffectiveness`: pre-populate `{response: {...existing aggregates}, load: zero, title: zero, ...}`; merge results from steps 6+7.
9. Update `cache-effectiveness-types.ts` with new field; keep backward-compat (FE handles missing `byKind` as response-only view).
10. **FE segment control**: simple ButtonGroup-style component, default selection `response`. Persist selection in URL query string (`?kind=load`) so links to specific kinds are shareable.
11. **FE hero rewire**: `cache-dashboard-hero.tsx` accepts `summary` prop directly (already does). Page swaps `summary` from `data.summary` (response default) to `data.byKind[selectedKind]` on segment change. Re-uses existing card markup.
12. Update `CacheDashboardPage` to pass `selectedKind` through.
13. Update FE tests: `cache-tab.test.tsx`, `cache-dashboard-hero.test.tsx` — add a case for `selectedKind = 'load'`.

## Todo List

- [ ] N4: add deleted_at filter to 6 query functions
- [ ] N2: return null currentMetaHash when no gameId
- [ ] Write N4 + N2 regression tests
- [ ] Extend kv-cache-store with aggregateByKind
- [ ] Add queryPromptCacheTokens
- [ ] Extend computeCacheEffectiveness with byKind
- [ ] Extend FE types with byKind
- [ ] Create cache-kind-segment.tsx
- [ ] Wire selectedKind in CacheDashboardPage (URL-persisted)
- [ ] Rewire hero to consume selected kind
- [ ] Update FE tests
- [ ] Manual: load /dev/chat-audit/cache, switch segments, verify numbers change

## Success Criteria

- N4: Soft-deleting a session immediately drops its contributions from cache aggregates on next refresh.
- N2: All-games view shows `currentMetaHash === null` and per-game stale counts remain correct.
- Dashboard segment control switches hero numbers between 6 kinds.
- Prompt-cache segment shows `cache_creation` + `cache_read` totals from `chat_turns`.
- All existing FE and BE tests still pass.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| N4 fix changes existing aggregate numbers for users with old soft-deletes | High (intended) | Low | This IS the fix. Note in PR description: "dashboard numbers will drop after merge for accounts with soft-deleted sessions." |
| Snapshot/restore (snapshot-store.ts) round-trip vs new column | Low | Low | No schema change to existing tables; snapshot reads `chat_sessions.deleted_at` already (snapshot-store.ts:102). |
| `byKind` field absent for old BE versions during rolling deploy | Low | Low | FE handles missing field — falls back to response-only view. |
| Segment control adds clutter | Low | Low | Default-collapsed; show only when ≥2 kinds have hits. |

## Security Considerations

- All BE additions retain the `s.owner_id = ?` invariant. New `aggregateByKind` MUST take `ownerId` as the first WHERE clause column — never global.
- N4 fix is a privacy improvement (deleted-session data stops showing in aggregates).
- N2 fix is a correctness improvement, no privacy implication.

## Next Steps

- Phase 07 wraps tests + rollout.
- Follow-up: response_cache→kv_cache data migration (separate phase, not in this plan).
