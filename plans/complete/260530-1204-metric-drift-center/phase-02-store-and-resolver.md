# Phase 02 — Drift Snapshot Store + Resolver Grouping

## Context
- Reuse: `metric-ref-validator.ts` (`validateRefs`, `parseFqn`), `metric-coverage-resolver.ts`, `anomaly-state-store.ts` (upsert pattern), `business-metrics-loader.ts` (`getAll`).
- Applicability field + `metric_drift_snapshot` table from phase-01.

## Overview
- Priority: P1.
- Status: pending.
- Two new pure-ish services: a SQLite store for the drift snapshot (mirroring `anomaly-state-store`), and a grouping helper that collapses flat `UnresolvedRef[]` into root-cause buckets. Plus an applicability-aware filter so N/A cells drop out of drift.

## Data flow
- IN: `UnresolvedRef[]` (from `validateRefs`), the registry (`getAll()`), per-game applicability from `meta.applicability`, plus the `workspaceId` of the writing path (`'local'` for detector, active id for live).
- TRANSFORM:
  - `groupDriftByRootCause(refs)` → `RootCauseGroup[]` keyed by missing cube (for `cube-missing`) or missing `cube.member` (for `member-missing`/`unparseable`), each carrying `affectedMetricIds[]` + count + reason.
  - `applicableForGame(metric, game)` → boolean (latest applicability entry; default true).
  - Drift counting excludes refs whose metric is N/A for that game.
- OUT: grouped report consumed by phase-03 endpoint; store rows consumed by detector bridge (phase-04) and the page.

## Requirements
### Functional
1. **Store** `server/src/db/metric-drift-snapshot-store.ts`:
   - `upsertDriftRows(db, { workspaceId, game, source, rows: {metricId, ref, reason}[] })` — **replace-per-`(workspace, game, source)`** semantics: delete existing `(workspace_id, game, source)` rows then insert current set inside one transaction (a ref that resolved this run must disappear). Idempotent. Switching workspace never touches another workspace's rows.
   - `listDriftRows(db, { workspaceId?, game?, source? })` → rows (callers filter by scope).
   - `source` enum is `'detector' | 'live'`. Detector writes `workspaceId:'local', source:'detector'`; live page writes `workspaceId:<active>, source:'live'`.
   - Keep under 200 lines; pure SQL + `getDb()` injection like the audit store.
2. **Grouping** add to a new `server/src/services/metric-drift-grouping.ts` (pure, no I/O):
   - `groupDriftByRootCause(refs: UnresolvedRef[]): RootCauseGroup[]`
   - `RootCauseGroup = { kind: 'cube-missing'|'member-missing'|'unparseable'; key: string; reason; affectedMetricIds: string[]; affectedCount: number; refs: string[] }`.
   - `cube-missing` groups by cube name (the `key`); `member-missing`/`unparseable` group by full ref.
3. **Applicability filter** add to `metric-ref-validator.ts` OR a small new `metric-applicability.ts` (KISS — new file, single responsibility):
   - `applicableForGame(metric, game): boolean` (latest `meta.applicability` entry per game; missing = true).
   - `filterApplicable(refs, metricsById, game)` — drop refs for metrics marked N/A for `game`.
   - **N/A is a property of the metric (registry YAML), NOT the workspace.** So the
     applicability filter is independent of the `(workspace, game, source)` store keying —
     it runs the SAME way for the live path, the detector path, and every workspace. Apply
     `filterApplicable` BEFORE grouping/persisting in both paths. A metric N/A for `ptg` is
     excluded from `ptg` drift regardless of which workspace is active or which source wrote
     the row.
4. **Resolver wiring** in `metric-coverage-resolver.ts`: `coverageFromSnapshot` / `matrixForGame` exclude N/A cells from `drift` status (an all-N/A-broken game is `ok`, not `drift`). Add an optional `applicabilityFilter` param so the pure functions stay testable without globals.

### Non-functional
- Grouping + applicability are pure → unit-testable without network/DB.
- Store transaction-safe (delete+insert atomic).

## Related code files
- Create: `server/src/db/metric-drift-snapshot-store.ts`, `server/src/services/metric-drift-grouping.ts`, `server/src/services/metric-applicability.ts`.
- Modify: `server/src/services/metric-coverage-resolver.ts` (apply applicability filter to drift status + matrix).

## Implementation steps
1. Write the store (transactioned delete+insert, list).
2. Write grouping helper + types.
3. Write applicability helper.
4. Thread applicability filter into `coverageFromSnapshot` and `matrixForGame` (optional param defaulting to "always applicable" to preserve current callers).
5. typecheck.

## Todo
- [ ] `metric-drift-snapshot-store.ts` (upsert replace-per-`(workspace,game,source)`, list with scope filter)
- [ ] `metric-drift-grouping.ts` (`groupDriftByRootCause`)
- [ ] `metric-applicability.ts` (`applicableForGame`, `filterApplicable`)
- [ ] resolver excludes N/A cells from drift
- [ ] typecheck passes

## Success criteria
- 30 `cube-missing` refs for one cube collapse to ONE group with `affectedCount: 30`.
- A metric marked N/A for ptg no longer contributes to ptg's `drift` status or matrix `broken`/`cube-missing` cell (renders a distinct `n/a` state — phase-05).
- `upsertDriftRows` twice with a shrinking set leaves only the latest rows for that `(workspace_id, game, source)`.
- Writing rows for `(workspaceB, game, live)` leaves `(workspaceA, game, live)` and `(local, game, detector)` rows untouched.
- A metric marked N/A for `ptg` is excluded from `ptg` drift across ALL workspaces and both sources (applicability is registry-scoped, not workspace-scoped).

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Replace delete wipes another scope's rows | M×H | Scope DELETE to `WHERE workspace_id=? AND game=? AND source=?` only; cover with tests that (a) detector + live rows for same game coexist, (b) two workspaces' live rows for same game coexist. |
| Applicability default flips meaning (missing = N/A) | L×H | Default = applicable (true); explicit test for the no-entry case. |
| Changing resolver signature breaks `/coverage` callers | M×M | New param optional, defaults to current behaviour; enumerate callers: `resolveCoverageForGame`, `resolveCoverageAllGames` (both in same file), route `business-metrics.ts:97,107`. |

## Security
- Store is internal; no direct route. Writes happen via phase-03/04 which carry authz.

## Next
- Phase 03 (endpoints) + phase 04 (detector) both depend on this.

## Decided
- **`unparseable` refs stay per-ref** (rare; each is a distinct YAML typo). Grouping key = full ref.
- **Applicability interacts cleanly with `(workspace, game, source)` keying** (re-verified): N/A
  lives in the registry YAML (`meta.applicability`), so `filterApplicable` is applied
  identically before grouping in the live path, the detector bridge, and for every workspace.
  Excluded refs never get persisted under any scope. No coupling between applicability and the
  store key.

## Unresolved
None.
