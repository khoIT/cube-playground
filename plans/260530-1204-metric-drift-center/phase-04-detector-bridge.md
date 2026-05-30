# Phase 04 — Detector → Product Bridge

## Context
- Detector: `server/src/jobs/anomaly-detector.ts`. `scanGameLegacy` (lines 126-183) already computes `validateRefs(metrics, snapshotFromMeta(meta))` and logs the full unresolved detail (lines 148-153).
- Store: `metric-drift-snapshot-store.ts` (phase-02), `workspaceId:'local', source:'detector'`.
- **Target (decision D1 in plan.md — CORRECTED):** the detector stays on the **local `game_id`
  model** (`:4000`, `resolveCubeTokenForGame` minted per-game tokens) — the only place drift is
  meaningful, because cube names match the registry verbatim. It is **NOT** repointed onto prod
  (`prefix` model would mark every metric `cube-missing`). Detector rows persist under
  `(workspace_id:'local', game, source:'detector')` and never overwrite the page's
  `source:'live'` rows under the active workspace id.

## Overview
- Priority: P2.
- Status: pending.
- Persist the detector's per-game unresolved set to the store and shrink the noisy log line to a count + pointer. Pure plumbing — no new query traffic (the validate call already runs every scan).

## Data flow
- IN: `unresolved: UnresolvedRef[]` already computed in `scanGameLegacy` (line 148).
- TRANSFORM: `filterApplicable` (drop registry-N/A metrics — same filter as the live path, since N/A is registry-scoped) → map to store rows `{metricId, ref, reason}` → `upsertDriftRows(db, { workspaceId:'local', game, source:'detector', rows })`.
- OUT: `metric_drift_snapshot` rows under `('local', game,'detector')`; a shrunk log line.

## Requirements
### Functional
1. After computing `unresolved` in `scanGameLegacy`, apply `filterApplicable` (drop registry-N/A metrics — keeps detector and live counts consistent), then call `upsertDriftRows({ workspaceId:'local', game, source:'detector', rows })` (replace-per-`(workspace,game,source)`). When the filtered set is empty, still call with `rows: []` so a now-resolved game clears its detector rows.
2. Replace the verbose log (line 152) with: `[anomaly-detector] game="<g>": <N> metric(s) have unresolved refs — see Drift Center` (count + pointer; drop the full `id→ref (reason)` dump).
3. Guard the store write in try/catch — a SQLite hiccup must NOT abort the detector scan (best-effort, log+continue; mirror audit-insert contract).
4. Do the same in the SQLite-mode path **only if** it computes a comparable unresolved set — `runDetectorTick` currently iterates `ANOMALY_METRICS` and does NOT call `validateRefs`, so leave it untouched (YAGNI). Bridge lives in the legacy `scanGameLegacy` path which already validates.

### Non-functional
- No extra Cube calls.
- `NODE_ENV==='test'` already disables the detector (line 209) — bridge writes won't fire in unrelated tests. Phase-06 tests call `scanGameLegacy`/`runDetectorOnce` directly with an injected DB.

## Related code files
- Modify: `server/src/jobs/anomaly-detector.ts` (import store, write after validate, shrink log).
- Read for context: phase-02 store.

## Implementation steps
1. Import `upsertDriftRows` + `getDb` into the detector.
2. In `scanGameLegacy`, after the `unresolved` block: `filterApplicable` → map → `upsertDriftRows({workspaceId:'local', game, source:'detector', rows})` inside try/catch.
3. Shrink the warn line to count + pointer.
4. typecheck.

## Todo
- [ ] Apply `filterApplicable` before persisting (registry-N/A consistency with live path)
- [ ] Persist detector unresolved set via `upsertDriftRows` (`workspaceId:'local', source:'detector'`)
- [ ] Clear rows when a game has zero unresolved
- [ ] Shrink log line to count + "see Drift Center"
- [ ] try/catch so store failure can't abort scan
- [ ] typecheck passes

## Success criteria
- After `runDetectorOnce` (legacy) with a ptg-like game, `listDriftRows(db, {workspaceId:'local', game:'ptg', source:'detector'})` returns the unresolved refs (minus any registry-N/A).
- A game whose refs all resolve leaves zero detector rows after a run.
- Log line is one line per game, no per-ref dump.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Detector (local `game_id`) differs from active page workspace → "two truths" | M×M | `(workspace_id, source)` keying keeps them distinct; page shows detector rows in a SEPARATE panel (D3). Both stay on `game_id` where drift is meaningful. |
| Store write throws and kills the scan loop | L×H | try/catch + log; never rethrow. |
| Someone later repoints the detector onto prod (`prefix`) → all metrics false cube-missing | L×H | Explicitly DECIDED against (D1): detector stays on local `game_id`; verified no ref translation (`metric-ref-validator.ts:99`). Prefix support is the v1.5 sub-project. |

## Security
- Detector is a server-side job; writes are `source:'system'`-equivalent (no actor). No HTTP authz.

## Next
- Phase 05 may surface detector rows; phase 06 tests the bridge.
