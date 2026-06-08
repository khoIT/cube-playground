# Phase 1 — Hot User/Behavior Cube Rollups

**Priority:** P1. **Status:** pending. **blockedBy:** Phase 0.

## Target cubes — ordered by REAL demand (starter-question count, 2026-06-08 broad test)
Prioritized by how many of the 108 seeded questions hit each no-rollup cube:

| Cube | # real qs | Measured cold | Rollup to add |
|---|---|---|---|
| `new_user_retention` | **15** | 3.5s–timeout | `nru`,`npu`,`rnru_d*` by `report_date`(day) × `platform`,`country_code`,`media_source`,`is_paid_install` |
| `mf_users` (jus/pubg/cfm) | **15** | ~10s | install-cohort: `user_count_approx`,`paying_users`,`ltv_*` by `install_date`(day) × `country`,`media_source`,`is_paid_install` |
| `recharge` (non-ballistar) | 6 | 4.3s–timeout | `transactions`,`revenue_vnd`,`paying_users_exact`→approx,`arppu_vnd` by `recharge_date`(day) × `payment_channel` |
| `user_recharge_daily` | 5 | 3.5s | `paying_users`(approx),`revenue_vnd_total`,`txn_count_total` by `log_date`(day) |
| `retention` | (segment path) | 3.5s–>15s fail | `cohort_size`,`retained_d1/3/7/14/30` by `install_date`(day) |

Notes:
- `mf_users` already has a rollup on ballistar+muaw → extend SAME pattern to jus/pubg/cfm. `recharge` has a rollup only on ballistar → extend to others. `new_user_retention`/`user_recharge_daily`/`retention` have NO rollup on any game.
- **`etl_*` behavior cubes (cfm) are hit by ~10 real questions** but are row-level event tables — general rollups don't fit. Deferred/flagged: only add a targeted day-grain event-count rollup if a specific shape dominates. Decide in Phase 3 after Phase 0 build proves the pipeline.

## Pattern (mandatory)
For each: `<name>_batch` (`type: rollup`, HLL `count_distinct_approx` for user counts, `partition_granularity: month`, `refresh_key: {every: 1 hour|6 hours, incremental: true}`, `build_range` 2025-01-01→CURRENT_DATE) + `<name>` (`type: rollup_lambda`, `union_with_source_data: true`). Mirror `cube-dev/cube/model/cubes/ballistar/active_daily.yml` and `mf_users.yml`.

## Files (cube-dev)
- `cube/model/cubes/{ballistar,muaw,jus,pubg,cfm}/retention.yml`
- `.../new_user_retention.yml`, `.../user_recharge_daily.yml`, `.../mf_users.yml` (jus/pubg/cfm)

## Steps
1. Add batch+lambda pre-agg block per cube, copying the closest existing example's measure/dim names (verify against `/meta` per game — names confirmed identical across games).
2. Choose dims deliberately: only dims that segment predicates + dashboards actually filter (country, payer_tier/tier, media_source, platform, is_paid_install). Extra dims explode partition cardinality.
3. Refresh cadence: 1h for daily facts, 6h for `mf_users` (lifetime, slow-moving) — matches existing convention.
4. Rebuild, await refresh, re-run harness per cube → assert `usedPreAggregations` non-empty + record latency delta.

## Success criteria
- Each target cube serves its standard query from CubeStore (proven via `usedPreAggregations`).
- `retention` on cfm no longer 504s; lands in sub-second/low-second band.

## Risks
- Cross-cube rollups (dims from `mf_users` via join) require the join to exist + be `many_to_one`; otherwise build fails. Verify joins before adding country/payer dims.
- HLL approx count: confirm with user it's acceptable on segment count card (user said yes 2026-06-08) — exact uid lists still scan (out of scope).
