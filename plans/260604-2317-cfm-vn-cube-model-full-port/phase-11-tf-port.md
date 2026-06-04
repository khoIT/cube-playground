---
phase: 11
title: 'tf: Full Port'
status: completed
priority: P2
effort: 0.5d
dependencies:
  - 1
  - 2
  - 8
---

# Phase 11: tf — Full Port (Total Football)

## Overview
Mechanical bare-name port of the upstream `tf` per-game 360 set: 12 cubes + `user_360.yml`. Identical shape to cros (login/logout/register events, no game-specific event cubes). Schema `tf`. Runnable in parallel with cfm/cros.

## Requirements
- Functional: tf folder compiles under a `game: "tf"` JWT (schema `tf`); 360 views resolve for a fixture user.
- Non-functional: bare names; PII `public: false`; guardrail covers tf `etl_*`.

## Architecture
Source `kraken cubes/tf/*` (prefixed `tf_*`, `sql_table: tf.<table>`) → local `cubes/tf/*` bare. Same 12 cubes as cros:
`mf_users, active_daily, recharge, user_recharge_daily, user_roles, user_devices, user_ips, user_active_monthly, user_recharge_monthly, etl_login, etl_logout, etl_register`.
View `views/tf/user_360.yml` → bare-named.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/tf/*.yml` (12 files)
- Create: `cube-dev/cube/model/views/tf/user_360.yml`

## Implementation Steps
1. Confirm Phase 8 added `tf: 'tf'` to `GAME_SCHEMA`.
2. For each cube + the view: `fetch_kraken.sh` → `bare_rename.py --game tf` → write.
3. Trino-verify every `sql_table` + column against `game_integration.tf`. Fix drift.
4. Sample-query `mf_users`, `user_roles`, `etl_login` (bounded) for a real tf `user_id`.
5. Compile tf folder; confirm view join_paths resolve.

## Success Criteria
- [ ] 12 tf cubes + `user_360.yml` created, bare-named, schema-stripped.
- [ ] Every column Trino-verified in `game_integration.tf`.
- [ ] 360 views compile + return data for a fixture tf user.
- [ ] PII `public: false`; `etl_*` guardrail enforced.

## Risk Assessment
- tf is a football game — `role`/`server` semantics may differ from FPS games; field meanings verified via Trino, not assumed.
- Same mechanical-port drift risk as cros. Mitigation: per-tenant Trino verify.
- Can be merged in one pass with Phase 10 (shared transform); kept separate for clean per-tenant verification + review.
