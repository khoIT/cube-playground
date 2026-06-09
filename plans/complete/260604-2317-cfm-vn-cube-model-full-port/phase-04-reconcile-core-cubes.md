---
phase: 4
title: Reconcile Core Cubes
status: completed
priority: P1
effort: 1d
dependencies:
  - 1
  - 2
  - 3
---

# Phase 4: Reconcile Core Cubes

## Overview
Field-merge the 4 cubes that exist in BOTH local and kraken: `mf_users`, `recharge`, `active_daily`, `user_recharge_daily`. Local versions are hand-trimmed; kraken versions are richer. Reconcile per-field (do not blind-overwrite) so the dashboard's `cfm_user_profile`/`activity_timeline`/`recharge_timeline` views get every member they request.

## Requirements
- Functional: superset of {local fields, kraken fields needed by views} present + Trino-verified.
- Non-functional: keep local's working dimensions; additive merge; no regression to existing local consumers (segments/presets that reference these cubes).

## Architecture
Per cube, diff local vs kraken-bare, then take the **union**, preferring kraken's SQL where it models more columns AND Trino confirms they exist:
- `mf_users`: ADD `engagement_segment`, `appsflyer_id` (+ any view-required dim missing locally). The `cfm_user_profile` view needs all 34 members already mapped except `engagement_segment` — that is the one true gap. Verify `engagement_segment` source column in Trino (likely a CASE dim upstream — copy kraken's `case:` block, do not alias to `lifecycle_stage`).
- `recharge`: local intentionally omits `country_code`/`os_platform`/`role_*`/`is_first_recharge`/`money_type`/`iap`/`web`. The `cfm_user_transactions` + `cfm_revenue_metrics` views reference `role_name`, `money_type`, `is_first_recharge`, `iap`, `web`, `country_code`, `os_platform`. ADD them from kraken IF Trino shows the raw columns exist in cfm `etl_ingame_recharge`; else keep local omission + drop those view includes (note in Phase 7).
- `active_daily`: union dims; ensure `client_ip`, `device_id`, `role_id`, `role_class`, `max_role_level`, `max_fighting_power`, `online_time_sec`, `is_recharge_day`, `distinct_servers_today`, `distinct_devices_today` all present (activity_timeline view needs them — all already in local). Likely no-op or minor.
- `user_recharge_daily`: union dims; recharge_timeline view needs `payment_channel`, `product_id`, `revenue_vnd`, `txn_count`, `server_id` — all present locally. Likely no-op.

## Related Code Files
- Modify: `cube-dev/cube/model/cubes/cfm/mf_users.yml`
- Modify: `cube-dev/cube/model/cubes/cfm/recharge.yml`
- Modify: `cube-dev/cube/model/cubes/cfm/active_daily.yml`
- Modify: `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml`
- Reference: kraken `cubes/cfm_vn/{mf_users,recharge,active_daily,user_recharge_daily}.yml`

## Implementation Steps
1. For each cube: produce a member-level diff (local vs kraken-bare) — name, sql, type.
2. Trino-verify every kraken-only column actually exists in the cfm table (recharge is the risky one — local's omission note claims columns are absent in CFM raw vs ballistar).
3. Apply additive merge: keep local dims, append verified kraken-only dims/measures/segments. Preserve local descriptions where better.
4. Re-grep local consumers: `grep -rn "mf_users\.\|recharge\.\|active_daily\." src/` to ensure no member rename breaks segments/presets. Renames are forbidden — additions only.
5. Compile-check (Phase 9 harness or `cube` dev server) after each cube.

## Success Criteria
- [ ] `mf_users` has `engagement_segment` + `appsflyer_id`, Trino-verified, profile view fully satisfiable.
- [ ] `recharge` carries the view-required columns OR the unavailable ones are documented + dropped from views.
- [ ] `active_daily`/`user_recharge_daily` cover their timeline views.
- [ ] No existing local member renamed/removed (grep clean).

## Risk Assessment
- Blind-copying kraken `recharge` SQL would reference columns absent in cfm raw → compile/query failure. Mitigation: Trino-gate every added column (step 2).
- `engagement_segment` semantics: if it's a derived CASE on columns cfm lacks, port the exact upstream expression; if upstream columns absent, flag to user (don't fabricate a definition).
- Hidden consumers of these cubes in segments/preset cards. Mitigation: grep + additive-only rule.
