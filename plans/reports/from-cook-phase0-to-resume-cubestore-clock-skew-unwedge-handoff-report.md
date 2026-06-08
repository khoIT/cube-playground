# Phase 0 Hand-off — CubeStore Un-Wedge (colima clock-skew) + Resume Steps

**Date:** 2026-06-08 19:30 GMT+7 | **Plan:** `plans/260608-1733-user-behavior-cube-preagg-rollout/` | **Status:** Phase 0 root-caused + fixed; rebuild paused for laptop close.

## What was wrong (verified, not the plan's assumption)
Plan assumed CubeStore dormant = no building worker. FALSE. Workers exist + run (dev `cube_refresh_worker_dev`→`cubestore_dev`; stack `cube_refresh_worker`→`cubestore`, both 24h+). Real cause: **colima VM clock-skew after host sleep** → CubeStore `SystemTimeError: second time provided was later than self` → metastore corrupt → partitions build then "not found" on readback (27/27) + unique-constraint collisions + cache resets → `usedPreAggregations` always empty.

## What was done this session
1. Verified skew on BOTH stacks (dev + stack cubestores + workers).
2. Paused watchdogs (`SIGSTOP` `ensure-cube-api.mjs --watch`).
3. `colima restart` → clock resynced (host == container).
4. `docker stop`+`rm` 6 cube containers; `docker volume rm cube-playground_cubestore_dev_data cube-playground_cubestore_data`.
5. Recreated via wrapper `STACK_DEV_CUBE=1 node scripts/stack-local.mjs up -d cube_api_dev cubestore_dev cube_refresh_worker_dev cube_api cubestore cube_refresh_worker` → fresh stores, correct `v1.6.46-arm64v8` tag, **0 skew errors** on clean boot.
6. Resumed watchdogs (`SIGCONT`).
7. Rebuild started but `sweeps=0` (no partitions built yet) when user had to close laptop. **Stopped both refresh workers** to keep fresh volumes pristine through the sleep/skew window. APIs + cubestores left UP → :3000 and :11000 keep serving (live Trino, un-accelerated).

## Current state at hand-off
- 6 cube containers: APIs + cubestores UP; **2 refresh workers STOPPED** (deliberate).
- Fresh empty cubestore volumes (nothing built — `sweeps=0`).
- docs/lessons-learned.md + memory `cubestore-preaggs-dormant-locally` updated with root cause + fix.

## RESUME STEPS (next session, laptop AWAKE, keep it awake through rebuild)
1. `colima restart` — MANDATORY first (sleep re-skewed the clock). Verify: `docker exec cube-playground-cubestore-dev date` ≈ host `date`.
2. Check for any sneaked-in corruption: `docker logs cube-playground-cubestore-dev | grep -c "second time provided"`. If >0 OR any partitions exist, re-wipe volumes (step from this report's "What was done" #4) and recreate (#5).
3. Start the workers: `STACK_DEV_CUBE=1 node scripts/stack-local.mjs up -d cube_refresh_worker_dev cube_refresh_worker` (or they restart with the dev:all watchdog recovery / a full wrapper `up -d`).
4. Re-kick the monitor: `python3 /tmp/preagg_rebuild_monitor.py` (polls ballistar lambda + ptg plain-rollup canaries until `usedPreAggregations` non-empty). Worker sweeps every 300s; first partitions land in minutes, full coverage longer.
5. **Phase 0 gate passes when:** ptg `ordered_funnel_canonical` returns rows with non-empty `usedPreAggregations` AND ballistar `active_daily.dau` = PREAGG. Then capture cold/warm "after" latency vs baseline (mf_users ~10s, retention 3.5–>15s).
6. Only AFTER gate passes → unblock Phase 1 (hot-cube rollups) + Phase 2 (cros/tf/ptg-lambda).

## Unresolved questions
1. Will the fresh-volume rebuild expose the pre-existing `recharge`/`mf_users` etc. rollups as serving, or surface new errors once partitions actually land? (Couldn't reach `sweeps>0` this session.)
2. Recurrence hardening: is there a colima time-sync option to avoid the per-sleep `colima restart`? (Out of scope so far; `colima restart`-at-session-start is the current workaround.)
3. Prod topology (plan open Q1): does prod playground query a building worker, or is prod ALSO dormant? Still unanswered — orthogonal to this local fix.
