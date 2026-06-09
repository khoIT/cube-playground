---
phase: 10
title: 'cros: Full Port'
status: completed
priority: P2
effort: 0.5d
dependencies:
  - 1
  - 2
  - 8
---

# Phase 10: cros — Full Port (CrossFire: Legend)

## Overview
Mechanical bare-name port of the upstream `cros` per-game 360 set: 12 cubes + `user_360.yml`. cros is a clean clone of the standard 360 shape (no FPS-specific event cubes — only login/logout/register events). Lowest-complexity game; runnable in parallel with cfm phases.

## Requirements
- Functional: cros folder compiles under a `game: "cros"` JWT (schema `cros`); 360 views resolve for a fixture user.
- Non-functional: bare names; PII (`device_id`/`client_ip`) `public: false`; guardrail covers cros `etl_*`.

## Architecture
Source `kraken cubes/cros/*` (prefixed `cros_*`, `sql_table: cros.<table>`) → local `cubes/cros/*` bare. 12 cubes:
`mf_users, active_daily, recharge, user_recharge_daily, user_roles, user_devices, user_ips, user_active_monthly, user_recharge_monthly, etl_login, etl_logout, etl_register`.
View `views/cros/user_360.yml` → bare-named (`cros_user_profile` → `user_profile`, etc.).

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cros/*.yml` (12 files)
- Create: `cube-dev/cube/model/views/cros/user_360.yml`

## Implementation Steps
1. Confirm Phase 8 added `cros: 'cros'` to `GAME_SCHEMA` + guardrail matches bare `etl_*`.
2. For each cube + the view: `fetch_kraken.sh` → `bare_rename.py --game cros` → write.
3. Trino-verify every `sql_table` + column against `game_integration.cros` (inventory from Phase 1). Fix drift.
4. Sample-query `mf_users`, `user_roles`, `etl_login` (bounded) for a real cros `user_id`.
5. Compile cros folder; confirm view join_paths all resolve.

## Success Criteria
- [ ] 12 cros cubes + `user_360.yml` created, bare-named, schema-stripped.
- [ ] Every column Trino-verified in `game_integration.cros`.
- [ ] 360 views compile + return data for a fixture cros user.
- [ ] PII `public: false`; `etl_*` guardrail enforced.

## Risk Assessment
- cros table set may differ subtly from cfm (e.g. column names). Mitigation: Phase 1 inventory is per-tenant; don't assume cfm parity.
- `etl_register` exists in cros/tf but not cfm — ensure the guardrail + any register panel view handle it.
- Mechanical port risk = silent column drift. Mitigation: Trino-verify, not just compile.
