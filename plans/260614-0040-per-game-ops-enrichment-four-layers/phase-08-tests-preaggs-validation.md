# Phase 08 — Tests + Pre-Aggregations + Validation

## Context Links
- Pre-agg pattern (copy): `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml:157-189` (rollup + lambda union +
  120-day build_range + monthly partition)
- Memory: `cube-rollup-authoring-rules` (time-dim must match query; additive measures only; verify by compiled SQL),
  `cube-preagg-build-mechanics-harness` (`cube-dev/scripts/measure-preagg-build.sh`; log_date DATE bug),
  `cubestore-introspection-and-probe-hardening` (readiness probe asserts usedPreAggregations),
  `cubestore-preaggs-dormant-locally` (rollup defs exist but no partitions built locally — assert usedPreAggregations)
- Tests: vitest (`src/**/__tests__/`), playwright; readiness probe `server/src/services/workspace-readiness.ts`

## Overview
- **Priority:** P1 — proves correctness + prevents scan blowups.
- **Status:** pending · **Depends on:** Phase 7.
- **Description:** Add CubeStore pre-aggs for the big event/transaction tables (thinking_data, payment callback
  logs) with date-partition pruning; write vitest/playwright covering new cubes, segment dims, dashboard cards,
  member360 hooks; add readiness + usedPreAggregations assertions; add a freshness-regression guard.

## Key Insights
- Big tables (thinking_data cfm 198M/jus 17.8M, callback logs 2.6M) WILL blow up scans if queried raw → pre-agg
  with monthly partitions + bounded build_range (copy user_recharge_daily lambda pattern). User-grain cubes
  (payer_daily, user_geo, lifecycle/behavior profile) are smaller but still benefit from rollups for dashboards.
- Pre-agg correctness rules (memory `cube-rollup-authoring-rules`): rollup time-dim MUST match the query's time
  dim; additive measures only (count_distinct_approx OK, exact count_distinct NOT rollup-able); verify routing by
  reading COMPILED SQL, not just `usedPreAggregations` (lambda can mask a non-building plain rollup).
- Locally pre-aggs are often DORMANT (memory `cubestore-preaggs-dormant-locally`) — partitions may not build
  without DEV_MODE/restart. Test must assert usedPreAggregations AND tolerate the cold-source fallback path.
- Freshness regression: a test that fails if a cube tagged `live` actually sources a lagging table (or vice
  versa) — keeps the governing constraint honest over time.

## Requirements
- Functional: pre-aggs on event/txn cubes (date-partitioned); unit tests for new FE dims/cards/hooks; cube
  compile + per-game /meta integration test; readiness probe asserts new cubes resolve.
- Non-functional: no full-table scan on 100M+ tables (partition prune enforced); tests pass without fake data/mocks
  of the DB (per dev rules); freshness tags validated.

## Architecture
- Data flow (test): build pre-agg → query → assert usedPreAggregations + compiled-SQL partition prune →
  assert revenue/geo/CS numbers match a Trino ground-truth probe for a known user.
- Pre-agg lives in the cube YAML (rollup + rollup_lambda); CubeStore stores partitions per game (preagg schema isolation).

## Related Code Files
- Modify: phase 2–4 cube YAMLs that hit big tables — add `pre_aggregations:` (payer_daily, payment_callback,
  behavior_profile/events if exposed, cs_action_log if large). Copy user_recharge_daily lambda shape.
- Create: vitest specs under `src/pages/**/__tests__/` for new dashboard cards + segment dims + member360 hooks
- Create/extend: integration test asserting new cubes in `/meta` per game + usedPreAggregations
  (extend existing readiness/probe harness; see `cube-dev/scripts/`)
- Read: `cube-dev/scripts/measure-preagg-build.sh`, `server/src/services/workspace-readiness.ts`

## Implementation Steps
1. Add pre-aggs to event/txn cubes: rollup (additive measures + matching time-dim + monthly partition +
   bounded build_range) + rollup_lambda union — copy `user_recharge_daily.yml:157-189`. One per big cube.
2. Build + verify via `measure-preagg-build.sh`; read COMPILED SQL to confirm partition prune + routing (memory rule).
3. vitest: new dashboard cards render with tokens; segment dims selectable; member360 shows new facts; freshness
   badge renders for lagging cubes.
4. Integration: per game, assert new cubes present in `/meta?extended=true`; a known-user query returns expected
   numbers matching a Trino probe; usedPreAggregations true (tolerate cold fallback per memory).
5. Freshness-regression test: assert each cube's `[freshness:]` tag matches its source table's tier (table→tier map).
6. Run full vitest + playwright; fix failures (no mock-DB cheats per dev rules); re-run until green.

## Todo List
- [ ] Pre-aggs on big event/txn cubes (partition prune + lambda)
- [ ] Build + compiled-SQL routing verification
- [ ] vitest: cards + dims + member360 + freshness badge
- [ ] Integration: per-game /meta + known-user numbers + usedPreAggregations
- [ ] Freshness-regression test
- [ ] Full suite green (no mock-DB)

## Success Criteria
- Big-table cubes route through CubeStore pre-aggs (compiled-SQL verified) with date-partition prune; no full scans.
- Known-user revenue/geo/CS numbers match Trino ground truth at the phase-1 match-rate.
- vitest + playwright green; freshness-regression test passes; readiness probe sees new cubes.

## Risk Assessment
- **Pre-agg silently not routing** (Med×High): lambda masks non-building rollup (memory). Mitigate: verify by COMPILED SQL, not just usedPreAggregations.
- **Local dormant pre-aggs fail CI** (Med×Med): partitions don't build locally. Mitigate: assert-or-tolerate-cold pattern; restart cube_api.
- **Non-additive measure in rollup** (Med×Med): exact count_distinct breaks rollup. Mitigate: count_distinct_approx in rollups (authoring rule).

## Security Considerations
- Pre-agg tables hold aggregates only; no PII in rollup dimensions (no IP/phone/email).
- Tests use real Trino (no mocked DB per dev rules) — credentials via env, never committed.
