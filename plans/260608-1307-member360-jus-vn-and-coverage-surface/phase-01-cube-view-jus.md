# Phase 01 — Cube view: jus user_360 (cube-dev-old repo)

## Overview
- Priority: P1
- Status: not started
- Depends on: phase-00 (jus include lists)
- Repo: `/Users/lap16299/Documents/code/cube-dev-old` (NOT cube-playground)

## Tasks
1. Create `cube/model/views/jus/user_360.yml` modeled on `views/ballistar/user_360.yml`, exposing the
   **core 4** views only: `user_profile`, `user_activity_timeline`, `user_recharge_timeline`,
   `user_transactions`. Use the phase-00 include lists (drop dims jus lacks). Keep `user_audience` /
   `revenue_metrics` / `activity_metrics` if jus base cubes support them (parity with ballistar segmentation).
2. Do NOT add CFM-style event panels (`user_login_panel`, `user_matches_panel`, …) — jus has no `etl_*`
   event cubes. The coverage surface will report these as "not modeled".
3. Validate: restart/refresh local Cube, hit `/meta` for the jus workspace, confirm the 4 views appear
   with expected members and a 1-row `user_id`-filter query returns data for each.

## Related files
- Create: `cube/model/views/jus/user_360.yml`
- Read for template: `cube/model/views/ballistar/user_360.yml`
- Read for available members: `cube/model/cubes/jus/{mf_users,active_daily,user_recharge_daily,recharge}.yml`

## Success criteria
- Local Cube `/meta` (jus) lists the 4 core views; sample single-user queries return rows.
- No member references a dimension absent from jus base cubes (no Cube compile errors).

## Risk / dependency
- **Prod parity is separate.** Prod uses the prefixed/upstream (kraken) model; this local view does not
  propagate to prod. Authoring the prod-side `jus_*` 360 views is upstream work — record as a tracked
  dependency; the coverage surface (phase-03/04) will display prod as blocked until it lands.
- Naming/`view = cube` convention: confirm resolver expects view names equal to logical names used by
  panels (it physicalizes member prefixes, not view-name remaps) — verified in phase-00.
