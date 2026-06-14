# Pre-Aggregation Rollout for User/Behavior Cubes

**Goal:** Make CubeStore actually serve queries in the local cube-dev workspace — first by getting a refresh worker to build partitions (today: zero built), then by extending rollup coverage to the user/behavior cubes that segment/chat/dashboard paths hit, plus closing per-game gaps.

**Why now (measured 2026-06-08):**
- CubeStore is **dormant** — both reachable stacks (`:4000`, `:11000`) have rollup *definitions* but **no built partitions**. `usedPreAggregations` empty on every query; ptg's plain `rollup` hard-404s "instance not set up to build pre-aggregations"; lambda-wrapped rollups silently serve 100% live source.
- **Broad test over all 108 seeded starter questions** (real click distribution, 6 games): **0% served from CubeStore**; cold p50 **8.8s**, p90 **11.5s**; **23% (25/108) exceed the 15s gateway cap and hard-fail**. (Concurrency-5 run inflates absolute ms/timeout count vs clean serial numbers below; coverage split + failing shapes are concurrency-independent.)
- **50% of real questions touch a cube with NO rollup def** (cros 100%, cfm_vn/pubg 56%, jus_vn 39%, muaw 33%, ballistar 17%) → can never hit CubeStore until rollups added. The other 50% have defs but are dormant → Phase 0 alone fixes them.
- Clean serial latency (single-query): `mf_users` ~10s, `retention`/`user_recharge_daily` 3.5–4.4s, `recharge`/`active_daily` 0.8–4.3s, warm 8–22ms.
- Impact = interactive starter-question/chat/segment latency (multi-second→sub-second) + capability unlock (>31-day behavior windows) + removing the 15s-timeout failures. Infra/Trino-offload secondary (low volume).
- Full data: `plans/reports/from-latency-probe-to-planner-broad-starter-question-cubestore-report.md`.

**Scope decision (user-confirmed):** hot cubes first + close game gaps. Approx (HLL) counts acceptable.
**Out of scope:** exact uid-list materialization / segment export / member-360 fan-out (inherently row-level — rollups don't help these).

## Phases

| # | Phase | Status | Gates |
|---|---|---|---|
| 0 | [Worker build + validation gate](phase-00-worker-build-validation.md) | pending | **BLOCKS all others** — no rollup work until `usedPreAggregations` proven non-empty |
| 1 | [Hot user/behavior cube rollups](phase-01-hot-cube-rollups.md) | pending | blockedBy 0 |
| 2 | [Close per-game gaps (cros/tf/cfm)](phase-02-close-game-gaps.md) | pending | blockedBy 0 |
| 3 | [Re-measure + tune playground caches](phase-03-remeasure-and-cache-tune.md) | pending | blockedBy 1,2 |

## Key constraints
- Use **`rollup_lambda` + `union_with_source_data`** everywhere (graceful live-tail fallback). Avoid bare `rollup` — it hard-fails when partitions absent (ptg lesson).
- HLL `count_distinct_approx` for user counts → one day-grain rollup serves week/month/quarter via sketch merge (pattern already in `active_daily.dau_daily_batch`).
- Rollup defs live in sibling model `cube-dev/cube/model/cubes/<game>/*.yml` — NOT in this repo's `server/`.
- Per-game refresh contexts already enumerated in `cube-dev/cube/cube.js` `scheduledRefreshContexts()`.

## Open questions
1. ~~Which deployed Cube instance does **prod** playground query, and does it run a building refresh worker?~~ **RESOLVED 2026-06-08:** deployed `playground.gds.vng.vn` `local` workspace is ALSO dormant (HTTPS canary: ballistar `trino`/empty, ptg 404 "not set up to build"). Both local + deployed run worker mode via `CUBEJS_SCHEDULED_REFRESH_TIMER=300` (NOT the `CUBEJS_REFRESH_WORKER` boolean). Local worker proven building (~48 partitions, 0 errors) but blocked by **partition-volume slowness** (Cube warns "Long Execution... reduce partitions via rollup_lambda"); deployed cause needs box SSH. So Phase 0 ≠ "enable worker" but "make a full build COMPLETE" (narrow build_range / lambda). See `plans/reports/from-cook-phase0-to-planner-worker-mode-on-via-timer-and-prod-local-dormancy-report.md`.
2. Is the `:11000` worker mis-wired (worker up but not building / not sharing CubeStore with the API), or just never triggered? Phase 0 resolves.
3. Source-data freshness: do the user/behavior source tables have data in the `2025-01-01→today` build range, or will partitions build empty?
