# Canonical Cube Catalog (frozen spec) — Phase 01

> Source-table-driven. The 33 common-core tables below are verified present in `game_integration.cfm_vn`
> (Trino `information_schema`, 2026-06-14) and byte-identical across all 8 games (prior finding 1).
> cfm is the reference game (richest cube suite). Bare `sql_table` + per-tenant schema resolution
> (`cube.js:292-307` preAggregationsSchema/driverFactory) makes ONE canonical YAML valid for every game.

## The 33 common-core tables (verified)

| Family | Count | Tables |
|--------|-------|--------|
| `mf_*` | 4 | mf_users, mf_ingame_roles, mf_ingame_devices, mf_ingame_ips |
| `map_*` | 2 | map_ingame_devices_and_userid, map_ingame_ips_and_userid |
| `etl_ingame_*` (standard 3) | 3 | etl_ingame_login, etl_ingame_logout, etl_ingame_recharge |
| `std_*` | 11 | std_ingame_user_active_daily/_monthly, std_ingame_user_recharge_daily/_monthly, std_ingame_role_active, std_ingame_role_active_daily/_monthly, std_ingame_role_recharge, std_ingame_role_recharge_daily/_monthly, std_marketing_cost_all_channels_by_game |
| `cons_*` | 13 | cons_game_key_metrics_daily/_monthly, cons_game_new_user_retention_daily/_monthly, cons_game_cumulative_rev_by_new_user_daily, cons_game_recall_user_active_monthly, cons_game_recall_user_recharge_monthly, cons_game_user_active_daily/_monthly, cons_game_user_recharge_daily/_monthly, cons_server_key_metrics_daily/_monthly |

## Coverage reality — cfm models only 13 of 33 core tables

**Tier A — has a frozen cfm template (13 cubes, ready to templatize as-is):**

| # | Cube | Source core table | Grain / PK | Join to hub | Fan-out class | Tier |
|---|------|-------------------|-----------|-------------|---------------|------|
| 1 | `mf_users` | mf_users (+ mf_ingame_roles for ingame_name CTE) | 1/user; PK `user_id` | HUB | hub | 1 |
| 2 | `active_daily` | std_ingame_user_active_daily | 1/user/day; PK `CONCAT(user_id,'__',log_date)` | many_to_one mf_users | spoke | 1 |
| 3 | `user_recharge_daily` | std_ingame_user_recharge_daily | 1/user/recharge-day | many_to_one mf_users | spoke | 1 |
| 4 | `recharge` | etl_ingame_recharge + std_ingame_role_recharge (txn bridge) | per-txn; PK `vng_transaction` | `{recharge}.gds_user_id = {mf_users}.user_id` | spoke (event, bounded) | 1 |
| 5 | `game_key_metrics` | cons_game_key_metrics_daily | 1/day×dims | standalone | mart | 1 (unlocks ~24 metrics) |
| 6 | `new_user_retention` | cons_game_new_user_retention_daily | cohort×day | standalone | mart | 1 |
| 7 | `retention` | computed from std_ingame_user_active_daily (custom cohort SQL, first_seen/activity CTEs) | install_date cohort | standalone (computed) | mart | 1 |
| 8 | `marketing_cost` | std_marketing_cost_all_channels_by_game | 1/day/channel | standalone | mart | 2 |
| 9 | `user_active_monthly` | std_ingame_user_active_monthly (custom window: first_active_month, was_active_prev_month) | 1/user/month | many_to_one mf_users | spoke | 2 |
| 10 | `user_recharge_monthly` | std_ingame_user_recharge_monthly | 1/user/month | many_to_one mf_users | spoke | 2 |
| 11 | `user_roles` | mf_ingame_roles | 1/(user,server,role); PK `CONCAT(user_id,'__',server_id,'__',role_id)` | many_to_one mf_users | **spoke (FAN-OUT GUARD)** | 2 |
| 12 | `user_devices` | map_ingame_devices_and_userid | 1/(user,device) | many_to_one mf_users | spoke (PII `public:false`) | 3 |
| 13 | `user_ips` | map_ingame_ips_and_userid | 1/(user,ip) | many_to_one mf_users | spoke (PII `public:false`) | 3 |

**Tier B — care/rolling cubes derived from already-templated core tables (3 cubes, copy from cfm):**

| Cube | Derived from | Notes |
|------|--------------|-------|
| `user_active_rolling` | std_ingame_user_active_daily (custom rolling 7d/30d) | care signal cube; PK `user_id` (`public:true`); no pre-aggs (non-additive window) |
| `user_recharge_rolling` | std_ingame_user_recharge_daily (custom rolling 1d/7d/30d) | care signal cube; spike/drop ratios; `public:true` |
| `ordered_funnel_canonical` | UNION etl_ingame_{login,logout,recharge}(+register) | optional Tier-3 canonical; only if the standard 3 events exist; carries `canonical_daily` rollup |

**Tier C — cfm-extra, NOT in the 33 core → DEMOTE to L3 bespoke (do NOT templatize):**

| Cube | Source | Why bespoke |
|------|--------|-------------|
| `user_gameplay_daily` | `etl_ingame_game_detail` (NOT in 33 core; per-game ladder/clan semantics) | ladder_rank/clan signals are cfm-FPS-specific; game_detail column sig varies per game |
| `ordered_event_funnel` | UNION raw `etl_ingame_*` (parametric) | query-bound behavior cube; lives behind BEHAVIOR_VIEWS bound (`cube.js:108`); keep L3 |
| `etl_login`, `etl_logout`, `etl_money_flow`, `etl_lottery_shoot`, `etl_prop_flow`, `etl_room_match_flow`, `etl_team_start_match_flow`, `etl_newbie_detail`, `etl_newbie_tutorial`, `etl_game_detail` | raw `etl_ingame_*` event tables | column sigs vary per game (8 distinct) → hand-authored per game |

**Tier D — in the 33 core but UNMODELED even in cfm (20 tables, NO template exists):**

| Category | Core tables (count) | Conflict / consideration | Recommendation |
|----------|--------------------|--------------------------|----------------|
| **Role-grain (fan-out hazard)** | std_ingame_role_active, std_ingame_role_active_daily, std_ingame_role_active_monthly, std_ingame_role_recharge, std_ingame_role_recharge_daily, std_ingame_role_recharge_monthly (6) | Role grain is exactly the one-to-many fan-out the whole investigation guarded against. As cubes they MUST be `many_to_one` spokes, count_distinct-only, never in `reachableCubes`, and NO sum-of-per-role-revenue measures (dormant double-count). | Author as guarded spokes ONLY if a real consumer needs them; otherwise omit. Conflicts with locked fan-out guard if modeled carelessly. |
| **cons_ user-grain duplicates of std cubes** | cons_game_user_active_daily, cons_game_user_active_monthly, cons_game_user_recharge_daily, cons_game_user_recharge_monthly (4) | Duplicate DAU/recharge already modeled from `std_*` (cfm deliberately chose std). Modeling both = two cubes computing the same metric → DRY violation. | OMIT (std versions already cover). Document the std-over-cons choice. |
| **Monthly/aggregate variants of modeled daily cubes** | cons_game_key_metrics_monthly, cons_game_new_user_retention_monthly, cons_server_key_metrics_daily, cons_server_key_metrics_monthly (4) | Lower-value monthly/server rollups of already-modeled daily marts. | Author as standalone marts (low fan-out risk); Tier 3. |
| **Genuinely new marts (no equivalent modeled)** | cons_game_cumulative_rev_by_new_user_daily, cons_game_recall_user_active_monthly, cons_game_recall_user_recharge_monthly (3) | New analytical surfaces (cumulative-rev cohort, recall/winback monthly). No fan-out risk (standalone marts). | Author as standalone marts; Tier 2-3. Needs net-new dim/measure design (no cfm precedent). |
| **mf_ user-grain identity tables (alt source for devices/ips)** | mf_ingame_devices, mf_ingame_ips (2) | cfm models device/ip via `map_*` join tables (`user_devices`/`user_ips`), NOT the `mf_*` snapshots. Modeling both = duplicate. | OMIT (map versions cover); or replace map-based cubes with mf-based if richer. |

## mf_users canonical (locked baseline + variants)

```yaml
sql: >
  SELECT base.*, latest_role.ingame_name
  FROM mf_users base
  LEFT JOIN (
    SELECT user_id, max_by(ingame_last_active_role_name, ingame_last_active_date) AS ingame_name
    FROM mf_ingame_roles GROUP BY 1
  ) latest_role ON base.user_id = latest_role.user_id
```
- GROUP BY collapses roles → 1 name/user; LEFT JOIN cannot fan out the hub grain.
- 3 generator variants (triggers feed Phase 04):
  - **clean** (cfm-style): 7 of 8 games — use as-is.
  - **dual-identity** (jus): wrap source in `split_part(user_id,'@',1)` merge CTE — only when @-suffix detected (jus ~46.8%).
  - **role-name-absent** (tf): `ingame_last_active_role_name` 100% NULL → emit plain `sql_table: mf_users`, DROP `ingame_name` dim.

## Fan-out guard (success criterion — verified)
- `user_roles` join: `relationship: many_to_one`, `{CUBE}.user_id = {mf_users}.user_id` (cfm/user_roles.yml).
- `user_roles.roles_revenue_vnd/usd/txn` = `sum` on per-role recharge cols that are **unpopulated upstream** → DORMANT, do NOT metric-ize (double-count landmine).
- Member-name dim stays `mf_users.ingame_name`; `user_roles` NEVER enters any preset `reachableCubes`
  (`server/src/presets/bundles/mf-users-hub.yml:25` = `[mf_users]`).
- Same rule applies to ALL role-grain std_* cubes if Tier-D role-grain is authored.

## Pre-aggregation inventory (carried by templates)
- `mf_users`: ltv_by_install_cohort (+_batch), user_composition (+_batch) — rollup_lambda over install_date, partition year.
- `active_daily`: dau_by_country_payer / by_platform / by_ingame_dims (6 = batch+lambda each).
- `user_recharge_daily`: recharge_daily_by_channel (batch+lambda).
- `new_user_retention`: nru_retention_by_cohort (batch+lambda).
- `game_key_metrics`: key_metrics_by_source_daily (batch+lambda).
- `marketing_cost`: cost_by_source_daily (batch+lambda).
- `ordered_funnel_canonical`: canonical_daily (single rollup).
- ptg (Phase 06): any large cube emitted (mf_users/active_daily) gets mandatory rollups day one.

## Scope decision (RESOLVED 2026-06-14 — user)
**Generator template set = Tier A (13) + Tier B (3) = the 16 cubes that have a proven cfm template.**
All 20 Tier-D net-new core-table cubes (role-grain, cons/mf duplicates, net-new marts) are DEFERRED to a
later round — not authored by this generator pass. This refines the earlier "full-33" lock: ship the proven
16 first; full coverage is a follow-up. Honors DRY (no duplicate DAU/recharge cubes) + the fan-out guard
(no role-grain spokes authored this round).

Frozen 16: mf_users, active_daily, user_recharge_daily, recharge, game_key_metrics, new_user_retention,
retention, marketing_cost, user_active_monthly, user_recharge_monthly, user_roles, user_devices, user_ips,
user_active_rolling, user_recharge_rolling, ordered_funnel_canonical.

## Unresolved questions
None — scope resolved. Tier-D (20 cubes) tracked as a deferred follow-up backlog (categorized above).
