# Phase 01 — Canonical common-core cube spec

## Context links
- Reference set: `cube-dev/cube/model/cubes/cfm/*.yml` (richest, 19 canonical + 10 bespoke)
- Anomaly override: `cube-dev/cube/model/cubes/jus/mf_users.yml`
- Multi-tenant routing: `cube-dev/cube/cube.js:22-31` (GAME_SCHEMA), `:292-307` (per-game preagg schema + driver)
- Fan-out guard: `server/src/presets/bundles/mf-users-hub.yml:25,37-45`

## Overview
- Priority: P1 (blocks 03, 05, 06). Status: pending.
- Lock the definitive list of standard "Tier-1 common-core" cubes + their measures/dims/joins,
  derived by auditing cfm against the 33-table byte-identical common core. This spec is the
  contract the generator (03) emits and the preset reconcile (05) targets.

## Key insights
- 33 raw tables are present + byte-identical across all 8 games (verified finding 1) → ONE canonical
  YAML per cube works for all games because cube SQL uses BARE table names; schema resolves per-tenant
  in `cube.js` driverFactory (`:298-307`). This is the entire reason a single generator is viable.
- cfm is the only game with the full canonical suite. Use its cube files verbatim as the spec source.
- mf_users canonical = cfm-style (plain source + `latest_role` max_by CTE), `cfm/mf_users.yml:7-16`.
  jus's `split_part` merge is an anomaly override, NOT the baseline.
- Per-role recharge sum-measures in `user_roles` are dormant (return 0) — keep as documented forward-compat
  (`cfm/user_roles.yml:10-13`); do NOT promote to metrics until ETL backfills (double-count landmine, finding 4).

## Requirements
Functional:
- Produce a frozen "canonical cube catalog" doc (one section per cube): cube name, source raw table(s),
  grain/PK, joins (+relationship), the full dim/measure/segment list, and any pre-aggregations.
- Classify each canonical cube into a **tier** for rollout priority (Tier-1 = unlocks most metrics).
- Mark each cube's **fan-out class**: hub (`mf_users`, one row/user) vs spoke (`many_to_one` into hub) vs
  standalone mart (cons_/std_ daily). Spokes must declare `many_to_one` and stay out of preset reachableCubes.

Non-functional:
- Spec must be source-table-driven (33-table core), not cfm-file-driven where cfm has extras.
- SCOPE LOCKED (user 2026-06-14): canonical set = a cube for EVERY one of the 33 common-core tables
  (full coverage, incl. all std_role_*/cons_* marts) — do NOT demote marts to a subset. Bespoke
  etl_* cubes are explicitly excluded (L3).

## Canonical cube catalog (the spec — verified against cfm files)

| Cube | Source raw table(s) | Grain / PK | Join to hub | Fan-out class | Tier |
|------|---------------------|-----------|-------------|---------------|------|
| `mf_users` | `mf_users` (+ `mf_ingame_roles` for ingame_name CTE) | 1/user; PK `user_id` | HUB | hub | 1 |
| `active_daily` | `std_ingame_user_active_daily` | 1/user/day; PK user_id+log_date | `many_to_one` mf_users | spoke | 1 |
| `user_recharge_daily` | `std_ingame_user_recharge_daily` | 1/user/recharge-day | `many_to_one` mf_users | spoke | 1 |
| `recharge` | `etl_ingame_recharge` (bridged id) | per-txn | `mf_users.user_id={recharge}.gds_user_id` | spoke (event, bounded) | 1 |
| `retention` | `cons_game_new_user_retention_daily` | cohort×day | standalone | mart | 1 |
| `new_user_retention` | `cons_game_new_user_retention_*` | cohort | standalone | mart | 2 |
| `game_key_metrics` | `cons_game_key_metrics_daily` (+ marketing) | 1/day | standalone | mart | 1 |
| `marketing_cost` | `std_marketing_cost_all_channels_by_game` | 1/day/channel | standalone | mart | 2 |
| `user_roles` | `mf_ingame_roles` | 1/(user,server,role) | `many_to_one` mf_users | **spoke (fan-out guard)** | 2 |
| `user_devices` | `map_ingame_devices_and_userid` | 1/(user,device) | `many_to_one` mf_users | spoke (PII) | 3 |
| `user_ips` | `map_ingame_ips_and_userid` | 1/(user,ip) | `many_to_one` mf_users | spoke (PII) | 3 |
| `user_active_monthly` | `std_ingame_user_active_monthly` | 1/user/month | `many_to_one` mf_users | spoke | 2 |
| `user_recharge_monthly` | `std_ingame_user_recharge_monthly` | 1/user/month | `many_to_one` mf_users | spoke | 2 |
| `user_active_rolling` | `std_ingame_role_active` / cons rolling | rolling window | spoke/mart | 3 |
| `user_recharge_rolling` | `std_ingame_role_recharge` / cons rolling | rolling window | spoke/mart | 3 |

Notes:
- `ordered_event_funnel` / `ordered_funnel_canonical` are built from raw `etl_ingame_*` UNION (behavior-bounded
  in `cube.js:104-109`) — they sit between canonical and bespoke. Treat as **optional Tier-3 canonical**: same
  shape across games that have the standard 3 events, but query-bound. Generator emits only if the 3 standard
  events exist.
- `session` (from `etl_ingame_login`/`logout`) is the cfm `etl_login`/`etl_logout` pair — these are bounded event
  cubes. Decide in 02 whether "session" joins the canonical set or stays L3 (recommend L3: login/logout column
  sigs vary per game, finding 2).

## mf_users canonical (locked)
```yaml
sql: >
  SELECT base.*, latest_role.ingame_name
  FROM mf_users base
  LEFT JOIN (
    SELECT user_id, max_by(ingame_last_active_role_name, ingame_last_active_date) AS ingame_name
    FROM mf_ingame_roles GROUP BY 1
  ) latest_role ON base.user_id = latest_role.user_id
```
- `cfm/mf_users.yml:7-16`. GROUP BY collapses roles → 1 name/user, so LEFT JOIN cannot fan out the hub grain.
- Variants the generator must support (decided in 04):
  - **clean** (cfm-style): 7 of 8 games. Use as-is.
  - **dual-identity** (jus): wrap source in `split_part(user_id,'@',1)` merge CTE — only when @-suffix detected.
  - **role-name absent** (tf): `ingame_last_active_role_name` 100% NULL → emit plain `sql_table: mf_users`,
    DROP the `ingame_name` dim. Confirms with the `/meta` member-column check (`mf-users-hub.yml:37-41`).

## Related code files
Read (no edits this phase): all `cube-dev/cube/model/cubes/cfm/*.yml`, `jus/mf_users.yml`, `cube.js`.
Create: `plans/.../reports/canonical-cube-catalog.md` (the frozen spec). Optionally `docs/canonical-cube-model.md`
(main repo) once accepted.

## Implementation steps
1. For each canonical cube above, copy cfm's dim/measure/segment list into the catalog doc, annotating any
   measure that depends on dormant columns (role-level recharge) as "do not metric-ize yet".
2. Confirm the source raw table for each cube against the 33-table core (finding 1) — flag any cube whose
   cfm source is NOT in the common 33 (those are cfm-extra, demote from canonical).
3. Tier each cube using phase-02's reverse index (game_key_metrics=24, mf_users=11, active_daily=9, …).
4. Lock the 3 mf_users variants + their trigger conditions (feeds 04).
5. Record fan-out class per cube; assert user_roles=spoke and excluded from reachableCubes.

## Todo
- [ ] Catalog doc with all canonical cubes (dims/measures/segments/joins/pre-aggs)
- [ ] Source-table cross-check vs 33-table core; demote cfm-extras
- [ ] Tier assignment from phase-02 reverse index
- [ ] mf_users 3-variant spec + triggers
- [ ] Fan-out class column; user_roles guard noted

## Success criteria
- Every canonical cube has a single frozen YAML shape valid for any game (bare table names only).
- mf_users baseline = cfm-style, with jus/tf variants documented as conditional overrides.
- No canonical cube references a raw table outside the common 33 (or it's explicitly demoted).
- user_roles documented as `many_to_one` + reachableCubes-excluded.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| cfm has columns absent in other games despite "byte-identical" claim | Low×High | Finding 1 verified distinct col-sig=1 for the 33 core; cfm-extras live in bespoke etl_* (excluded). Cross-check step 2. |
| Treating a cfm-extra cube as canonical | Med×Med | Step 2 demotes any cube whose source ∉ 33-core. |
| Dormant role-recharge columns metric-ized → double count | Low×High | Annotate "do not metric-ize"; finding 4; preserved from `user_roles.yml:10-13`. |

## Security considerations
- `user_devices`/`user_ips` carry PII (device_id, client_ip) — canonical spec keeps `public: false`
  (`cfm/user_devices.yml:33`, `cfm/user_ips.yml:32`). Generator must preserve.

## Next steps
- Feeds phase 03 (generator emits this spec) and phase 05 (preset required_cubes target this set).
