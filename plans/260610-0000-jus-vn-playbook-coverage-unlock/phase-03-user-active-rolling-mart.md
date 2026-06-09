# Phase 03 — jus user_active_rolling mart → unlocks 15

**Priority:** P2 · **Status:** ☐ not started

## Context Links
- Template to PORT: `cube-dev/cube/model/cubes/cfm/user_active_rolling.yml`
- Registry: `playbook-registry.ts:235-248` (15 qualified_session_ratio < 0.2)
- jus source cube: `cube-dev/cube/model/cubes/jus/active_daily.yml` (over `std_ingame_user_active_daily`)

## Overview
Port cfm's `user_active_rolling` to jus. Materializes trailing 7d/30d session-time ratio per user as of the active-data anchor, so the session-time-drop predicate (15) is a plain cohort filter.

## Key Insights
- Source `std_ingame_user_active_daily` has `total_online_time` (discovery confirms; jus `active_daily.yml:3` maps the same table). cfm uses the same column name → near-verbatim port.
- Same as-of-anchor grain as Phase 02: a user idle the last 7d has `online_7d_total = 0` → `session_ratio = 0` (drop visible).
- Registry member: `user_active_rolling.qualified_session_ratio` (15). Same logical name as cfm → per-game /meta; zero registry edit.
- cfm flagged 15 **degenerate** (358k/661k) — activity is dense. The `qualified_session_ratio` floor (`online_7d_total > 0 AND online_30d_total >= 108000` [30h]) + the <0.2 cutoff must be **recalibrated against jus distribution** in Phase 06, not copied blindly.

## Data flow
`std_ingame_user_active_daily` (log_date, user_id, total_online_time) → anchor CTE (MAX log_date) → CASE-window SUMs 7d/30d → `session_ratio` / `qualified_session_ratio` dims → jus /meta → 15 flips `available` → sweep cohort filter.

## Requirements
- Functional: `user_active_rolling` in jus /meta with `user_id` (public PK), `log_date`, `online_7d_total/30d_total`, `session_7d_avg/30d_avg`, `session_ratio`, `qualified_session_ratio`.
- 15 (`qualified_session_ratio < 0.2`) flips to `available`.

## Architecture
Port cfm YAML; change titles → "JUS VN"; confirm source `std_ingame_user_active_daily` + `total_online_time`. Keep anchor CTE, CASE-window SUMs, NULLIF, the 30h floor (recalibrate in 06), `user_id` public, TIMESTAMP-wrapped `log_date`, no pre-agg.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/jus/user_active_rolling.yml`
- Read: cfm template, jus `active_daily.yml`.
- Modify: none.

## Implementation Steps
1. Copy cfm mart to jus dir; rename titles; verify `total_online_time` column on `std_ingame_user_active_daily`.
2. Restart `cube_api` (+ worker).
3. `/meta` jus scope: cube + members present, `user_id` public.
4. `/load`: row count + `session_ratio` distribution (anchor non-empty).
5. `/api/care/playbooks?game=jus_vn` → 15 = `available`.
6. Sweep → 15 cohort non-empty; note if degenerate (calibrate 06).

## Todo
- [ ] create jus user_active_rolling.yml (porting cfm)
- [ ] restart cube serving instance
- [ ] /meta shows cube + members (user_id public)
- [ ] /load session_ratio distribution sanity
- [ ] availability flips 15 → available
- [ ] sweep yields a cohort (record degeneracy for 06)

## Success Criteria
- 15 = `available` for jus_vn, producing a cohort; degeneracy flagged for Phase 06 recalibration.
- cfm 15 unchanged.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| session column differs from cfm | Low×Med | Verify against jus active_daily.yml first |
| 15 degenerate (dense activity, like cfm) | High×Med | Phase 06: exclude ratio=0, require real 30d baseline, percentile cutoff |
| YAML folded-comment trap | Med×Med | Comments outside folded sql block |

## Backwards Compatibility
New cube, additive; cfm same-name mart in separate dir unaffected.

## Security
Read-only mart; user_id only.

## Next
Independent. Feeds Phase 06 calibration (session floor + threshold).
