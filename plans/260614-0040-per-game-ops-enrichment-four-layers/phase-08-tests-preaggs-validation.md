# Phase 08 — Tests + Pre-Aggregations + Validation + Deploy/Rollback

## Context Links
- Pre-agg pattern (copy): `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml` (rollup + lambda union + bounded
  build_range + monthly partition)
- Routing probe (reuse): `server/src/services/preagg-readiness.ts:15-21` (compiled-SQL FROM-clause routing — NOT
  usedPreAggregations), `server/src/services/cubestore-query-cache-check.ts`
- Big-cube guard: `cube-dev/cube/cube.js:91-120` (BEHAVIOR_VIEWS + TIME_DIM_FIELDS)
- Model loader / compile-failure mode: `cube-dev/cube/cube.js:335-354` (reads every YAML per game)
- Memory: `cube-rollup-authoring-rules`, `cube-preagg-build-mechanics-harness` (`cube-dev/scripts/measure-preagg-build.sh`),
  `cubestore-introspection-and-probe-hardening`, `cubestore-preaggs-dormant-locally`
- Tests: vitest (`src/**/__tests__/`), playwright; readiness `server/src/services/workspace-readiness.ts`

## Overview
- **Priority:** P1 — proves correctness + prevents scan blowups + safe deploy.
- **Status:** pending · **Depends on:** Phase 7.
- **Description:** Add CubeStore pre-aggs for transaction-grain cubes (`billing_detail`) with date-partition
  pruning; write vitest/playwright covering new cubes, dims, cards, member360 panels; assert routing via COMPILED SQL
  (NOT usedPreAggregations); add a big-cube guard test + freshness-label regression test; ground-truth WITH the
  real_users_only filter; document deploy/rollback.

## Key Insights
- Transaction-grain billing (58.6M) WILL blow up scans if queried raw → pre-agg with monthly partitions + bounded
  build_range (copy `user_recharge_daily` lambda pattern). `billing_detail` is txn×breakdown grain (incl. `promotion_type`)
  → register with the big-cube scan guard (`cube.js:91-120`) if it qualifies. User-grain cubes (user_geo,
  lifecycle_profile, billing_lifetime) are smaller but still benefit from rollups for dashboards. The 285M
  `etl_sdk_login` events cube is DEFERRED (no cube, no pre-agg this round).
- **Routing is read by COMPILED SQL, NOT `usedPreAggregations` (red-team #7):** every lambda rollup
  (`union_with_source_data: true`) masks `usedPreAggregations` to EMPTY (`preagg-readiness.ts:15-21`). Assert the
  FROM-clause routes to `preagg_*` (reuse preagg-readiness.ts + cubestore-query-cache-check.ts). Do NOT assert
  `usedPreAggregations`.
- Pre-agg correctness (memory `cube-rollup-authoring-rules`): rollup time-dim MUST match the query's time dim;
  additive measures only (count_distinct_approx OK; exact count_distinct NOT rollup-able).
- Locally pre-aggs are often DORMANT (memory `cubestore-preaggs-dormant-locally`) — partitions may not build without
  restart. Test asserts routing AND tolerates the cold-source fallback path.
- **real_users_only ground-truth (red-team #8):** the known-user revenue comparison must apply the real_users_only
  filter on BOTH sides (cube + Trino), or unbridged rows make the cube look ~100x off.
- **Big-cube guard (red-team #6):** if the events cube is ever authored, a test must assert an UNBOUNDED query 4xx's
  (it's in BEHAVIOR_VIEWS + its time-dim in TIME_DIM_FIELDS). For this round, a regression test asserts no new big cube
  bypasses the guard.

## Requirements
- Functional: pre-aggs on transaction-grain cubes (date-partitioned); unit tests for new FE dims/cards/panels; cube
  compile + per-game /meta integration test; routing asserted via compiled SQL; big-cube guard test; freshness-label
  regression test; readiness probe sees new cubes.
- Non-functional: no full-table scan on big tables (partition prune enforced); tests use real Trino (no mocked DB per
  dev rules); freshness tags validated against source max-date.

## Architecture
- Data flow (test): build pre-agg → query → assert compiled-SQL FROM routes to preagg_* + partition prune → assert
  revenue/geo/CS numbers match a Trino ground-truth probe for a known user (WITH real_users_only).
- Pre-agg lives in the cube YAML (rollup + rollup_lambda); CubeStore stores partitions per game.

## Related Code Files
- Modify: new transaction-grain cube YAML — add `pre_aggregations:` (`billing_detail`). Copy user_recharge_daily shape.
- Create: vitest specs under `src/pages/**/__tests__/` for new cards + dims + member360 panels + freshness badge
- Create/extend: integration test asserting new cubes in `/meta` per game + compiled-SQL routing (extend the
  preagg-readiness harness; `cube-dev/scripts/measure-preagg-build.sh`)
- Read: `server/src/services/preagg-readiness.ts`, `cubestore-query-cache-check.ts`, `workspace-readiness.ts`

## Implementation Steps
1. Add pre-aggs to transaction-grain cubes: rollup (additive measures + matching time-dim + monthly partition +
   bounded build_range) + rollup_lambda union — copy `user_recharge_daily`. One per big cube.
2. Build + verify via `measure-preagg-build.sh`; read COMPILED SQL (reuse preagg-readiness.ts) to confirm partition
   prune + routing. Do NOT rely on usedPreAggregations.
3. vitest: new dashboard cards render with tokens; segment dims selectable; member360 panels show new facts; freshness
   badge (label) renders for lagging cubes.
4. Integration: per game, assert new cubes in `/meta?extended=true`; a known-user query returns expected numbers
   matching a Trino probe WITH real_users_only on both sides; compiled-SQL routes to preagg_* (tolerate cold fallback).
5. Big-cube guard regression test: assert no new big cube bypasses cube.js:91-120 (and if events cube is added later,
   an unbounded query 4xx's).
6. Freshness-label regression test: assert each cube's `[freshness:]` tag matches its iceberg source max-date tier
   (table→tier map) — keeps the advisory label honest.
7. Run full vitest + playwright; fix failures (no mock-DB cheats); re-run until green.

## Deploy / Rollback (red-team #15f)
- **One bad YAML fails the WHOLE game model compile** (`cube.js:348-350` reads every `.yml`); `DEV_MODE=false` ⇒ no
  hot reload. Therefore:
  - **Isolated compile-check BEFORE landing:** validate each new YAML compiles for its game (load `/meta` with that
    game's header on a scratch instance, or run the Cube schema-compile) before merging — a syntax error in one cube
    breaks every cube for that game.
  - **Deploy cubes BEFORE view edits:** land + verify the new cubes, THEN extend `user_360.yml`. A view referencing a
    not-yet-deployed member fails compile for the whole game.
  - **Restart `cube_api` (not just the worker)** so new cubes + rollups register (DEV_MODE=false = no hot reload).
  - **Rollback:** `git revert` the offending YAML + restart `cube_api`. Because the model is file-swept per request,
    reverting the file fully removes the cube; no migration/state to unwind. Verify `/meta` returns to the prior member set.
- Land per-layer (monetization MVP first) so a CS/identity compile error never blocks the shipped monetization layer.

## Todo List
- [ ] Pre-aggs on transaction-grain cubes (partition prune + lambda)
- [ ] Build + COMPILED-SQL routing verification (NOT usedPreAggregations)
- [ ] vitest: cards + dims + member360 panels + freshness badge
- [ ] Integration: per-game /meta + known-user numbers WITH real_users_only + compiled-SQL routing
- [ ] Big-cube guard regression test
- [ ] Freshness-label regression test (tag matches source max-date)
- [ ] Deploy/rollback dry-run: isolated compile-check, cubes-before-views, cube_api restart, git-revert rollback
- [ ] Full suite green (no mock-DB)

## Success Criteria
- Transaction-grain cubes route through CubeStore pre-aggs (compiled-SQL verified) with date-partition prune; no full scans.
- Known-user revenue/geo/CS numbers match Trino ground truth WITH real_users_only at the phase-1 match-rate.
- vitest + playwright green; big-cube guard + freshness-label regression tests pass; readiness probe sees new cubes.
- Deploy/rollback path documented + dry-run verified (isolated compile, cubes-before-views, restart, revert).

## Risk Assessment
- **Pre-agg silently not routing** (Med×High): lambda masks usedPreAggregations. Mitigate: verify by COMPILED SQL.
- **One bad YAML breaks the game model** (Med×High): whole-game compile failure. Mitigate: isolated compile-check before landing + per-layer deploy + revert rollback.
- **Local dormant pre-aggs fail CI** (Med×Med): partitions don't build locally. Mitigate: assert-or-tolerate-cold; restart cube_api.
- **Non-additive measure in rollup** (Med×Med): exact count_distinct breaks rollup. Mitigate: count_distinct_approx.

## Security Considerations
- Pre-agg tables hold aggregates only; no PII in rollup dimensions (no IP/phone/email/device/staff-id).
- Tests use real Trino (no mocked DB); credentials via env, never committed.
