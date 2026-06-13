# Investigation: is prod chart-data latency (#2) worth fixing?

**Date:** 2026-06-01 · **Trigger:** follow-up on deferred residual #2 from prod-workspace artifact-gap report.
**Verdict:** **YES, real & reproducible — but ~90% cube-dev (model + pre-agg materialization), ~10% cube-playground (agent dimension choice + gateway timeout).**

## Method

Direct timed `/load` probes against the prod mirror (`localhost:16000`), polling through Cube's "Continue wait" long-poll until data or hard timeout. Cube `ballistar_recharge.revenue_vnd`, day granularity, last 7 days.

## Evidence (measured)

| query time dimension | result | latency |
|---|---|---|
| `recharge_date` (what chat picks for "daily revenue") | **NEVER completes** | >152s / 30 polls, no data |
| `recharge_time` (the pre-agg's dimension), cold | completes | **25.8s** (5 polls), 7 rows |
| `recharge_time`, warm re-run | completes | ~5.2s (1 poll) |

`/meta` itself is fast (0.57s) — the bottleneck is purely query execution.

## Root causes (ranked)

### Primary — cube-dev model: `recharge_date` is a computed dim that can't hit the pre-agg
`ballistar/recharge.yml` defines `recharge_date` as
`from_iso8601_timestamp(CAST({CUBE}.log_date AS VARCHAR) || 'T00:00:00Z')` — a per-row function over `log_date`. The cube's only rollup, `revenue_daily_by_channel`, is keyed on `time_dimension: recharge_time` (a plain column). Cube rollup-matching is strict on time dimension, so a `recharge_date` query **cannot** match the rollup → full raw `etl_ingame_recharge` scan + per-row timestamp construction → never completes in budget.

### Primary — cube-dev infra: the rollup isn't materialized
Even the matching `recharge_time` query took **25.8s cold / ~5s warm**. A built rollup answers in <1s. So `revenue_daily_by_channel` is *defined* but apparently **not built** in the mirror (no refresh worker running it, or build never ran). This is the bug the original report guessed at — now confirmed: it's not cold-start jitter, the pre-agg simply isn't serving.

### Secondary — cube-playground app: agent routes "daily revenue" to `recharge_date`
The chat glossary/resolver maps daily revenue to the computed `recharge_date`, the one dimension that can never hit a rollup. Pointing it at `recharge_time` (plain, pre-agg-covered, cheaper) would let chat benefit the moment the rollup is built. **This overlaps with deferred item #1** (both are "which member does the resolver pick").

### Minor — cube-playground app: gateway `/load` timeout is 15s
`cube-proxy.ts:21` `CUBE_FETCH_TIMEOUT_MS = 15_000`. Even the *fast* path (25.8s cold) exceeds it → the gateway aborts → 504 → chat preview sees a timeout. Raising it only swaps a 504 for a ~26s spinner — cosmetic unless the pre-agg work lands first.

## Is it worth fixing? — yes, but not here-alone

- The user-visible symptom (prod chart never renders) is **real and 100% reproducible**, not flaky.
- The lever with the biggest payoff is **building `revenue_daily_by_channel`** + making the date-grain query able to hit it — both in **cube-dev**. That turns 25.8s→<1s and unblocks the `recharge_time` path.
- cube-playground can do two adjacent things that only matter once the rollup exists: (a) have the resolver prefer `recharge_time` for time-series revenue (ties into #1), (b) bump the `/load` proxy timeout to ~30s so warm-but-not-instant queries aren't killed at 15s.

## Recommended split

1. **cube-dev (owner: prod Cube model):** materialize `revenue_daily_by_channel` (verify refresh worker against the mirror); add/confirm a rollup that the daily-revenue query path can match (either add `recharge_date` grain or migrate daily revenue to `recharge_time`). Highest impact.
2. **cube-playground (small, optional, after #1 of this list):** resolver prefers `recharge_time` for time-bucketed revenue (fold into deferred disambiguation item #1); raise `CUBE_FETCH_TIMEOUT_MS` 15s→30s.

## Why the rollup isn't built — root-caused (follow-up dig)

The prod mirror `:16000` resolves to: `cube_gateway` → internal `cube_api` → `cubestore`, all from the **cube-api** repo (Colima/Lima port-forward, not a remote tunnel). The `:4000` "local" workspace is a *separate* stack from the **cube-dev** repo. The two have **diverged model copies** — and that's the core of it. Three independent causes, each alone sufficient:

1. **The prod-mirror model copy defines NO pre-aggregation (PRIMARY, definitive).**
   `cube-api/cube/model/cubes/ballistar_vn/recharge.yml` has **no `pre_aggregations`** block (grep: zero pre-aggs anywhere in `cube-api/cube/model`). The `revenue_daily_by_channel` rollup exists *only* in the cube-dev copy (`cube-dev/cube/model/cubes/ballistar/recharge.yml`), which backs `:4000` — not the mirror. **There is literally no rollup for the mirror to build.**

2. **Refresh worker disabled.** `cube-api/.env`: `CUBEJS_REFRESH_WORKER=false` — comment: *"disabled (no pre-aggs yet; spin-loops 100% CPU otherwise)."* Consistent with cause #1: it was switched off precisely because that model copy has no pre-aggs. So even if #1 were fixed, nothing schedule-builds partitions.

3. **Cube Store host misconfigured.** `cube-api/.env`: `CUBEJS_CUBESTORE_HOST=cubestore_router`, but the running container is named `cubestore` (`cube_api` resolves `cubestore`→172.22.0.2; **`cubestore_router` does not resolve**). So even an on-demand build would fail to reach Cube Store.

Net: every `:16000` query runs straight against Trino. `recharge_time` ≈ 25.8s (raw scan), computed `recharge_date` never completes — exactly the measured symptom.

## Fix location — entirely cube-api / cube-dev (NOT cube-playground)

Ordered by leverage:
1. **Resolve the model drift:** bring the pre-agg-bearing recharge model into the cube-api copy (or unify the two model trees so the mirror and `:4000` don't diverge). Without this, nothing else matters.
2. **Fix `CUBEJS_CUBESTORE_HOST`** → `cubestore` (or add a `cubestore_router` network alias).
3. **Re-enable `CUBEJS_REFRESH_WORKER=true`** once a real pre-agg exists (the original reason to disable it — "no pre-aggs yet" — no longer holds), or accept on-demand builds.
4. (cube-playground, only after the above, folds into deferred #1): resolver prefers `recharge_time` for time-series revenue; bump `/load` proxy timeout 15s→30s.

## Open questions

1. Is the model drift intentional (mirror deliberately runs a stripped model) or accidental (the cube-api copy is stale)? Decides "unify trees" vs "selectively port the pre-agg." — cube-api/cube-dev owner.
2. Should daily-revenue semantics standardize on `recharge_time` (event timestamp) vs `recharge_date` (log_date-derived)? They diverge for late-arriving events — a data-correctness decision, not just performance.
