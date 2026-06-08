# Phase 0 Round-2 — Worker Mode IS On (via timer), Real Blocker = Partition Volume; Prod-Local Also Dormant

**Date:** 2026-06-08 22:00 GMT+7 | **Plan:** `plans/260608-1733-user-behavior-cube-preagg-rollout/`

## Headline
After the colima clock-skew fix (round 1), local CubeStore STILL serves 0% on the canaries after 55 min — but **not because the worker is off.** The worker IS in refresh-worker mode and building; the blocker is **partition-volume slowness** (Cube's own warning). Separately, the **deployed `local` workspace on playground.gds.vng.vn is also dormant** (verified via HTTPS canary).

## Evidence — local dev worker (`cube_refresh_worker_dev`)
- Env: `CUBEJS_SCHEDULED_REFRESH_TIMER=300`, `CUBEJS_REFRESH_WORKER_CONCURRENCY=2`, **`CUBEJS_REFRESH_WORKER` NOT set** (neither true nor false).
- **Refresh worker mode IS active anyway** — worker logged `Refresh Scheduler Interval` + `Refresh Scheduler Long Execution: Interval #1 finished after 00:11:35. Please consider reducing total number of partitions by using rollup_lambda`. Up 59 min, **0 errors**, skew=0.
- Built **~48 partitions** (`/cube/data` 80M) then idle — first full sweep took 11m35s, exceeded the 300s interval (logged "Previous interval #1 was not finished").
- Canary cubes (`ballistar active_daily`, `ptg ordered_funnel_canonical`) NOT among the built set → still serve `trino`/404 after 55 min.
- Scale: 24 rollup files / 46 rollup blocks in the local model; wide `build_range` (2025-01-01→today, monthly) → hundreds of partitions. 48 built ≈ partial first pass.

## Reframe of the `CUBEJS_REFRESH_WORKER` hypothesis
- ✅ TRUE: the boolean `CUBEJS_REFRESH_WORKER` is false/unset on every instance (serving = explicit `false`; workers rely on the timer).
- ❌ BUT NOT "never on": the workers enable refresh-worker mode via `CUBEJS_SCHEDULED_REFRESH_TIMER=300` instead (deliberate — the boolean forces a 30s interval that starves the event loop; see `docker-compose.devcube.yml` comment). Proven on: the scheduler ran and built 48 partitions.
- So pre-aggs not serving ≠ "build mode off." Real cause = **build can't keep up with the partition count** (Cube literally warns to reduce partitions / use rollup_lambda), so a full pass doesn't complete and the canary cubes haven't been built yet.

## Deployed prod (`playground.gds.vng.vn`, `local` workspace) — VERIFIED dormant
HTTPS canary (read-only):
- `ballistar active_daily.dau` → `trino/live`, `usedPreAggregations: []`, 62 rows.
- `ptg ordered_funnel_canonical` → 404 "No pre-aggregation partitions were built yet … this API instance wasn't set up to build pre-aggregations."
- Same per-game model + same timer-based worker config as local. So prod-local pre-aggs are not serving either. Cause not determinable over HTTPS (no clock-skew there — Linux box). Candidates: worker not running, recently-reset cubestore mid/never-backfilled, same partition-volume slowness, or source/build gap. **Needs server-side access (SSH/docker on the box, or the `second` auto-deploy remote).**

## Implications for the rollout
1. **Phase 0 isn't "turn the worker on"** — it's "make a full build actually COMPLETE." Lever: narrow `build_range` (e.g. last 3–6 months for the canary), lean on `rollup_lambda` (live tail beyond the built window), fewer dims → fewer partitions. This is exactly what the plan's Phase 1 pattern + Cube's warning prescribe.
2. **Shipping rollup defs alone won't fix prod** until prod's worker is confirmed building AND the partition count is tractable.
3. Resolves plan open Q1: **prod-local is also dormant** (was "unknown").

## Unresolved questions
1. Does the local worker's scheduled refresh ever build the canary cubes' partitions, or does interval #1 "finish" with a fixed subset and never cover the rest? (Idle after 48; needs a partition-jobs inspection or a narrowed build_range test.)
2. Why is deployed prod-local dormant — worker down, cubestore reset, or same slowness? (Needs box access.)
3. Should `build_range` be narrowed model-wide (perf) vs per-rollup (surgical)? Affects Phase 1 authoring.
