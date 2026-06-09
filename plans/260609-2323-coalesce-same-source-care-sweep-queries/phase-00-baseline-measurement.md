---
phase: 0
title: "Baseline measurement + query-shape verification"
status: pending
priority: P0
effort: "1h"
dependencies: []
---

# Phase 0: Baseline measurement + query-shape verification

## Overview

**Measure before optimizing.** The coalescing win is only real if the playbooks being
collapsed are the *slow* ones. Coalescing four cheap single-table `mf_users` scans saves
almost nothing; coalescing four cold `user_gameplay_daily` scans is the actual prize.
This phase establishes the cfm_vn per-cube cohort-query baseline and verifies the
generated SQL shape, so Phases 2-3 can prove a real wall-time win (not just a lower
query *count*) and target the clusters that matter.

No runtime code. Pure investigation + a recorded baseline the later phases assert against.

## Why this phase exists (verified context)

- The sweep fires one `/load` per membership playbook (`care-case-sweep.ts` `makeCubeCohortFetcher`).
- cfm_vn membership clusters (from `playbook-registry.ts`): `mf_users` = 01/02/14/18;
  `user_gameplay_daily` = 06/08/09/17; rolling marts = 03/04 (`user_recharge_rolling`),
  15 (`user_active_rolling`). The other ids are trigger/unavailable → already skipped,
  so the **fireable** count is ~11, not 21 — the coalescing target is ~11 → ~5.
- Cube client timeout `CUBE_FETCH_TIMEOUT_MS = 15_000`, **no retry** (`cube-client.ts:30`).
  A query that exceeds 15s aborts → playbook `skipped:'query-failed'`. So slowness is
  per-wave 15s ceilings, not a retry storm.
- Rollups can't serve cohort queries (verified: cfm `mf_users` only pre-agg is
  `ltv_by_install_cohort_batch`, aggregate-grain on `install_date` — cannot project
  `user_id`). Query *count* and *contention* are the only levers — hence this plan.

## Requirements

**Functional**
1. **Per-cube cohort-query timing for cfm_vn.** For one representative membership
   playbook per cluster (e.g. 02 `mf_users`, 06 `user_gameplay_daily`,
   03 `user_recharge_rolling`, 15 `user_active_rolling`), record cold + warm wall time
   of its cohort query. Use the single-playbook manual sweep (`POST /api/care/cases/sweep?game=cfm_vn&playbook=<id>`)
   or replay the exact `loadWithCtx` query the fetcher builds. Capture from `cube_api`
   logs: total query time + whether a `Slow Query Warning` fired.
2. **Query-shape verification (the item-4 check).** For a pure-`mf_users` playbook (02 or
   14 — predicate references **only** `mf_users` members, no relative-date window),
   capture the generated SQL and confirm whether it is `FROM mf_users …` (clean
   single-table) or drags in `FROM etl_ingame_login LEFT JOIN mf_users …`. The
   dashboard's card queries all carry that join because they add a login-window filter;
   the **sweep's** mf_users query has no such window and *should* be single-table. If it
   still joins `etl_ingame_login`, that is a separate translator/identity-resolution
   inefficiency — record it as a finding (do **not** fix here; it may warrant its own
   plan and is out of this plan's "no model change" scope).
3. **Record the baseline** in `plans/reports/` (per naming convention): per-cluster cold
   ms, warm ms, slow-query yes/no, join shape, and the fireable-playbook count. This is
   the number Phase 3's "wall-time win" is measured against.

**Non-functional**
- Read-only / measurement only. Trigger sweeps off-peak (no dashboard cold-load running)
  so the baseline isolates per-query cost from the cross-feature contention Phase 4 owns.
- Auth note: the care write routes are gated; `POST /sweep` returns 401 without an
  authenticated identity (workspace header alone is insufficient — verified this session).
  Drive it through the SPA (logged-in session) or replay the `loadWithCtx` query directly
  against `cube_api` with a valid security context.

## Related Code Files

- Read: `server/src/care/care-case-sweep.ts` (query shape), `server/src/services/cube-client.ts`
  (timeout/no-retry), `server/src/care/playbook-registry.ts` (cluster membership),
  `cube-dev/cube/model/cubes/cfm/*.yml` (cube `sql_table` + joins for the slow clusters).
- Create: `plans/reports/care-sweep-cfm-vn-cohort-query-baseline-report.md`

## Implementation Steps

1. Identify the fireable membership playbooks for cfm_vn from `mergePlaybooks` (exclude
   trigger/unavailable/disabled/no-predicate). Confirm the ~11 figure and the cluster map.
2. For one playbook per cluster: trigger its single-playbook sweep cold (after a
   `cube_api`/cubestore restart or a fresh predicate so cache misses), capture `cube_api`
   query time + slow-query flag; repeat warm. Tabulate.
3. Capture the generated SQL for a pure-`mf_users` playbook; record join shape (item-4).
4. Write the baseline report. Flag the slowest cluster(s) — these are Phase 2's priority
   coalescing targets and Phase 3's wall-time-win subjects.

## Success Criteria

- [ ] cfm_vn fireable-playbook count + cluster map confirmed against `mergePlaybooks`.
- [ ] Cold + warm cohort-query time recorded per cluster; slowest cluster identified.
- [ ] Pure-`mf_users` cohort SQL join shape recorded (single-table vs `etl_ingame_login`
      join), with a finding noted if the join is unexpectedly present.
- [ ] Baseline report saved for Phase 3 to assert the wall-time win against.

## Risk Assessment

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Baseline taken under contention → inflated, misleading per-query numbers | M×H | Measure off-peak with no dashboard cold-load; Phase 4 owns the contention dimension separately |
| Cache warmth skews the "cold" number | M×M | Force a cold path (restart or novel predicate); record both cold and warm |
| Coalescing targets the cheap cluster, real cost elsewhere | M×H | This phase exists precisely to prevent that — Phase 2 prioritizes the measured-slow cluster |

## Next steps

Feeds Phase 2 (which clusters are worth coalescing) and Phase 3 (wall-time-win target).
Independent of Phase 1 (pure matcher) — can run in parallel.
