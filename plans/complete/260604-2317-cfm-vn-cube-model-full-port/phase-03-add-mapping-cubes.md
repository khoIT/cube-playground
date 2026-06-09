---
phase: 3
title: Add Mapping Cubes
status: completed
priority: P1
effort: 0.5d
dependencies:
  - 1
  - 2
---

# Phase 3: Add Mapping Cubes

## Overview
Port the 3 clean-add cubes that have **no local conflict** and directly unblock 3 of the 6 dashboard views: `user_roles`, `user_devices`, `user_ips` — plus the 2 monthly rollups (`user_active_monthly`, `user_recharge_monthly`). These are pure additions, lowest risk, done first to de-risk the view layer.

## Requirements
- Functional: each cube compiles, joins to `mf_users` via `user_id`, returns rows for a sample user.
- Non-functional: PII columns (`device_id`, `client_ip`) stay `public: false`.

## Architecture
Source → local cube (bare):
- `mf_ingame_roles` → `user_roles` (one row per user×server×role). Join `many_to_one` to `mf_users` on `user_id`.
- `map_ingame_devices_and_userid` → `user_devices` (user×device bridge).
- `map_ingame_ips_and_userid` → `user_ips` (user×ip bridge).
- `std_ingame_user_active_monthly` → `user_active_monthly`.
- `std_ingame_user_recharge_monthly` → `user_recharge_monthly`.

All five already use bare-ish kraken names with `cfm_` prefix + `cfm_vn.` table qualifier → apply Phase 2 rules.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/user_roles.yml`
- Create: `cube-dev/cube/model/cubes/cfm/user_devices.yml`
- Create: `cube-dev/cube/model/cubes/cfm/user_ips.yml`
- Create: `cube-dev/cube/model/cubes/cfm/user_active_monthly.yml`
- Create: `cube-dev/cube/model/cubes/cfm/user_recharge_monthly.yml`

## Implementation Steps
1. For each source cube: `fetch_kraken.sh` → `bare_rename.py` → write to `cubes/cfm/<name>.yml`.
2. Trino-verify (Phase 1 harness) each `sql_table` + every dimension/measure column exists in `cfm_vn`. Fix any column drift (kraken comment vs reality) per inventory.
3. For `user_roles`: confirm the per-role recharge cols (`ingame_total_recharge_value_vnd*`) — if Phase 1 shows them empty/absent, keep dimensions/measures but add a comment "NOT populated upstream — returns 0" (matches kraken note). Do not invent.
4. Sample-query each via Trino with a real `user_id` to confirm join key matches `mf_users.user_id` namespace.
5. Confirm `device_id`/`client_ip` carry `public: false`.

## Success Criteria
- [ ] 5 cube files created, bare-named, `sql_table` schema-stripped.
- [ ] Every column Trino-verified present; drift corrected.
- [ ] Sample `user_id` returns role/device/ip rows joinable to `mf_users`.
- [ ] PII dims `public: false`.

## Risk Assessment
- `mf_ingame_roles.user_id` vs `mf_users.user_id` namespace mismatch would silently return 0 rows on join. Mitigation: Trino cross-check a known user's role_ids.
- Monthly tables may not exist for cfm (kraken ships them schema-stable across games but cfm tables could lag). Mitigation: Phase 1 inventory gates inclusion — if absent, defer the 2 monthly cubes + their views to a follow-up and note it.
