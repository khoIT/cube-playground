# Phase 1 — Server: rolling cutoff two-pass + preview endpoint

## Overview
- **Priority:** P0 (foundation; unblocks percentile + top-N for the whole feature).
- **Status:** pending.
- Wire the existing percentile cutoff engine into segment **create** and **refresh** so
  a predicate with `percentileGte/Lte` materializes correctly, and re-resolves every
  refresh (rolling). Add a propose-time endpoint chat calls to preview cutoff + size.

## Key insights (verified)
- `percentileGte/Lte` ops + `PercentileValue {p, over}` already declared in
  `server/src/types/predicate-tree.ts` (~line 34, 63).
- `translator.ts` (~line 139) throws `PercentileNotResolvedError` when the
  `resolvedPercentiles` map lacks an entry — and the map is **never populated** at
  create (`routes/segments.ts` ~425 calls `treeToCubeFilters` with no options) nor at
  refresh (`jobs/refresh-segment.ts` has no resolve pass). So percentile segments 400 today.
- The engine works: `services/percentile-cutoff-resolver.ts`
  (`resolvePercentileCutoff`, `createTrinoPercentileExecutor`) — used only by
  `care/calibrate.ts`. Trino via `lakehouse/cs-trino-connector.ts` (`resolveCsTrinoConnector`).
- Measured overhead ≤0.7s raw / ≤4.7s jus merge → fits the 60s refresh budget; **one stage**.
- **Correctness:** unscoped p75 of `ingame_total_recharge_value_vnd` = 0 (free players
  dominate). Cutoff query AND membership query MUST use the SAME population filter.

## Requirements
**Functional**
- At create and every refresh, for each percentile leaf: run cutoff over the leaf's
  `over` population, inject result into `resolvedPercentiles`, then translate to `gte/lte`.
- Cutoff population = `over` filters; if absent, reject (no silent full-population default —
  caller must supply scope). Membership query inherits the same population.
- New endpoint `POST /api/segments/resolve-cutoff`: body `{game_id, cube, member, p, over}`
  → `{cutoff: number, estCount: number, population: {filter, count}}`. Used by chat propose.
- top-N is NOT a server concern — chat converts top-N→percentile before calling.

**Non-functional**
- Resolve pass shares the 60s refresh budget; cutoff query gets its own short Trino
  timeout (env-driven, reuse the existing wait-cap pattern) so a slow cutoff fails fast
  rather than starving the identity query.
- On cutoff failure → segment `status='broken'` with `broken_reason` (not a hard 500).

## Architecture / data flow
```
create or refresh (predicate w/ percentile leaf)
  → collectPercentileLeaves(tree)
  → for each: resolvePercentileCutoff({table: over.table, column: over.column ?? member, p}, trinoExec)
  → resolvedPercentiles.set(leaf.id, cutoff)
  → treeToCubeFilters(tree, { resolvedPercentiles })   // now yields gte/lte
  → existing Cube identity query (pass 2) over the SAME population
```
- Reuse `resolveCsTrinoConnector()` for the executor (already falls back to CUBEJS_DB_*,
  works on prod per cs-lakehouse-reader parity).

## Related code files
**Modify**
- `server/src/jobs/refresh-segment.ts` — add resolve pass before translate; re-resolve each run.
- `server/src/routes/segments.ts` — pass `resolvedPercentiles` into `treeToCubeFilters`
  at create; add `/resolve-cutoff` route.
- `server/src/services/translator.ts` — confirm `TranslateOptions.resolvedPercentiles`
  is threaded (already supported per code; just supply it).
**Create**
- `server/src/services/segment-cutoff-resolver.ts` — `collectPercentileLeaves(tree)` +
  `resolveSegmentCutoffs(tree, {game, connector})` (wraps `resolvePercentileCutoff`,
  applies population filter, returns `Map<leafId, number>` + est counts). <200 LOC.
**Read for context**
- `server/src/services/percentile-cutoff-resolver.ts`, `server/src/care/calibrate.ts`
  (consumer example), `server/src/lakehouse/cs-trino-connector.ts`.

## Implementation steps
1. `collectPercentileLeaves` — walk PredicateNode tree, return percentile leaves.
2. `resolveSegmentCutoffs` — for each leaf, build `PercentileQuery` from `over`
   (table/column/p), run executor; on missing `over` throw a typed `PopulationScopeRequiredError`.
3. Thread the map into `treeToCubeFilters` at create (`routes/segments.ts`) + refresh.
4. Refresh: call resolve pass each run (rolling); store nothing as authoritative cutoff.
5. Add `POST /api/segments/resolve-cutoff` — same resolver + a `count(*)` over population
   + a matched-count estimate; returns numbers for the confirm card.
6. Error handling: cutoff failure → `status='broken'`, `broken_reason='cutoff resolution failed: …'`.

## Todo
- [ ] `segment-cutoff-resolver.ts` (collect + resolve + scope-required error)
- [ ] thread `resolvedPercentiles` at create
- [ ] resolve pass in refresh (rolling, every run)
- [ ] `/resolve-cutoff` endpoint
- [ ] cutoff Trino timeout (env), broken-status on failure
- [ ] unit tests: collect, resolve, scope-required, translate-with-map

## Success criteria
- A POSTed predicate with `percentileGte {p:75, over:{table, column, filter}}` materializes:
  `uid_count` ≈ 25% of the scoped population (verified cfm 59,612 / jus 10,065).
- Re-refresh after data change moves the cutoff (rolling proven by test fixture).
- `/resolve-cutoff` returns cutoff+count in <5s for cfm_vn/jus_vn.
- Refresh stays < 60s including the cutoff pass.

## Risk assessment
- jus dual-identity merge percentile = ~4s; acceptable but the membership query must use
  the SAME merged-identity definition or cutoff ≠ cohort. Mitigate: percentile column for
  jus is the merged per-user value (mirror the cube SQL `split_part` GROUP BY).
- Population filter drift between cutoff query and Cube membership query → mismatched cohort.
  Mitigate: derive both from the single `over` spec.

## Security
- `/resolve-cutoff` must enforce the same game-scope/owner checks as other segment routes.
- No raw SQL from client — `over.table/column` validated against cube meta allowlist
  (prevent SQL injection into the percentile subquery).

## Next steps
- Phase 3 (chat) consumes `/resolve-cutoff`. Phase 2 catalog supplies the `over.column`
  (per-user dimension) + default population.
