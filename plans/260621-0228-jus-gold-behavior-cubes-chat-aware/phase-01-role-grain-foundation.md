# Phase 01 — Role-grain foundation

**Priority:** P0 (highest ROI, zero blockers) · **Status:** ☐ todo

## Overview
jus today is entirely **user (account) grain**. But it's an MMO: events key on `role_id`,
an account runs multiple characters, `mf_ingame_roles` bridges role→user. Two ready-made
`std_` role×day facts are completely unmodeled. Build them as role-grain cubes with
user-grain rollups via the bridge.

## Key insights
- `std_ingame_role_active_daily` already carries `total_online_time`, role_class, level
  min/max, `is_recharge`, server/channel/country — engagement WITHOUT touching 225M-row login/logout.
- `std_ingame_role_recharge_daily` carries vip min/max, product_id, vnd/usd splits, txn counts (iap/web).
- Source tables are `std_*` → the **cube must be named without the `std_` prefix** (e.g. `role_active_daily`), else chat strips it from `/meta`.
- Mirror cfm `active_daily.yml` (grain, composite PK, DAU/paying-DAU/online-time measures, post-agg ratio).

## Requirements
- `role_active_daily` cube: grain = (role_id, log_date). Bridge join to `user_roles` (→`mf_users`).
  - Dims: role_id, user_id, server_id, log_date(time), role_class, max/min role_level, is_recharge_day(bool), country, channel, platform.
  - Measures: `active_roles` (count_distinct_approx on composite), `active_users` (count_distinct_approx user_id), `paying_active_roles` (filtered is_recharge=1), `total_online_time_sec` (sum), `avg_online_min_per_role` (ratio).
- `role_recharge_daily` cube: grain = (role_id, log_date). Same bridge join.
  - Dims: role_id, user_id, server_id, log_date(time), max vip_level, last_product_id, first/last currency_code.
  - Measures: `revenue_vnd` (sum ingame_total_recharge_value_vnd), `revenue_usd`, `txn_count`, `txn_iap`/`txn_web`, `paying_roles` (count_distinct), `arppu_role` (ratio).
- Both: rollups (day granularity, month partition, lambda union) — these marts are small but rollups keep chat queries instant.

## Architecture
```
std_ingame_role_active_daily ──(role_id)──► user_roles ──(user_id)──► mf_users
std_ingame_role_recharge_daily ─(role_id)──► user_roles ──(user_id)──► mf_users
```
PK = `CONCAT(role_id,'__',CAST(log_date AS VARCHAR))`. Time dim = `log_date` coerced via
`from_iso8601_timestamp(CAST(log_date AS VARCHAR)||'T00:00:00Z')` (cfm convention).

## Related code files
- Create: `cube-dev/cube/model/cubes/jus/role_active_daily.yml`
- Create: `cube-dev/cube/model/cubes/jus/role_recharge_daily.yml`
- Read for pattern: `cube-dev/cube/model/cubes/cfm/active_daily.yml`, `cube-dev/cube/model/cubes/jus/user_roles.yml`, `cube-dev/cube/model/cubes/jus/user_recharge_daily.yml`

## Implementation steps
1. Re-probe `std_ingame_role_active_daily` / `std_ingame_role_recharge_daily` column values (class set, level range, vip range) to set dimension types right.
2. Write `role_active_daily.yml` mirroring cfm `active_daily.yml`; swap source + add role_class/level dims + bridge join.
3. Write `role_recharge_daily.yml` mirroring `user_recharge_daily.yml` at role grain + vip/product dims.
4. Add rollups to both (measures + low-card dims + log_date/day/month + lambda union).
5. Reload dev Cube model; verify compiled SQL + a sample query per cube.

## Todo
- [ ] Probe std role marts for dim domains
- [ ] role_active_daily.yml + join + measures
- [ ] role_recharge_daily.yml + join + measures
- [ ] rollups on both
- [ ] reload + verify query returns data (role + user grain)

## Success criteria
- `/cube-api/v1/meta` (game jus_vn) lists both cubes with measures/dims.
- A query `role_active_daily.active_roles` by `role_class` over last 7d returns rows.
- A query `role_recharge_daily.revenue_vnd` by `vip_level` returns rows; user-grain rollup via `mf_users` resolves.

## Risks
- `split_part(user_id,'@',1)` identity quirk in jus bridge (`user_roles.yml:22`) — match it in joins or rows drop. **Mitigation:** copy the exact ON-clause form from existing jus cubes.
- Double counting roles at user grain — use `count_distinct_approx`, never `count`.

## Next steps
Phase 02 (genre cubes) reuses the same bridge join + rollup shape.
