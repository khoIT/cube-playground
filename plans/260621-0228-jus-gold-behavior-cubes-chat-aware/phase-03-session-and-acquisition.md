# Phase 03 — Session/progression + acquisition (login/logout + register)

**Priority:** P2 · **Status:** ☐ todo

## Overview
Fill the progression + acquisition gaps. `etl_ingame_login`/`logout` (225M rows each, full
history to today) carry unused gold: VIP, level, fighting_power, guild, total_score, session
length. `etl_ingame_register` (3.6M) carries creation-time cohort signals. Session *length* per
role-day is already covered by Phase 01 (`total_online_time`), so these cubes target distribution,
progression timelines, guild membership, and acquisition cohorts — not daily DAU.

## Key insights
- Big raws (225M) → **rollups mandatory** + size warning + filter-required note in description (cfm `etl_login.yml` convention).
- `etl_ingame_login` carries `clientsdkuserid`? No — jus login keys on `role_id`/`account_id` (no clientsdkuserid column). Join via role bridge, NOT direct user (differs from cfm login). **Verify exact identity column before writing joins.**
- `logout.online_time` = session seconds (p50 459s, p90 3405s) → session-length distribution measure.
- `register`: `is_guest`, `born_server`, role_class/gender at creation, `pinch_face_time` (char-creator time).

## Requirements
- `login_progression` cube (from `etl_ingame_login`): grain = login event.
  - Dims: role_id, server, log_date(time), role_class, role_level, `vip_level`(via logout? login lacks vip — confirm; if absent, drop), `guild_id`, fighting via total_score.
  - Measures: `logins` (count), `logging_in_roles` (count_distinct_approx), `max_role_level` (max), `guilded_roles` (filtered guild_id<>'' / not null).
- `logout_session` cube (from `etl_ingame_logout`): grain = logout event.
  - Dims: role_id, server, log_date(time), `vip_level`(number), role_level, scene.
  - Measures: `sessions` (count), `total_session_sec` (sum online_time), `p50_session_sec`/`p90_session_sec` (approx_percentile), `avg_session_min` (ratio).
- `register_cohort` cube (from `etl_ingame_register`): grain = register event.
  - Dims: log_date(time), born_server, `is_guest`(bool), role_class, role_gender.
  - Measures: `registrations` (count), `guest_registrations` (filtered is_guest=1), `avg_charcreate_sec` (avg pinch_face_time).
- Rollups on login/logout (huge); register is small (optional rollup).

## Architecture
```
etl_ingame_login   ─(role_id)─► user_roles ─► mf_users
etl_ingame_logout  ─(role_id)─► user_roles ─► mf_users
etl_ingame_register─(role_id)─► user_roles ─► mf_users   # role created same event
```

## Related code files
- Create: `cube-dev/cube/model/cubes/jus/login_progression.yml`, `logout_session.yml`, `register_cohort.yml`
- Read for pattern: `cube-dev/cube/model/cubes/cfm/etl_login.yml`, `cfm/etl_logout.yml`

## Implementation steps
1. DESCRIBE-verify the exact identity column on login/logout/register (role_id vs account_id) and which carries vip_level/guild_id.
2. Write the 3 cubes with role-bridge joins, PII dims `public:false`, size warnings.
3. Rollups on login/logout (day/month, lambda + dteventtime twin — these are append-heavy event tables).
4. Reload + verify; spot-check session percentiles match the source probe.

## Todo
- [ ] verify identity + progression columns
- [ ] login_progression.yml
- [ ] logout_session.yml
- [ ] register_cohort.yml
- [ ] rollups (login/logout) + dteventtime twin
- [ ] reload + verify

## Success criteria
- `logout_session.avg_session_min` by `vip_level` returns the gradient.
- `register_cohort.registrations` by `born_server` over last 30d returns rows.
- Rollup routing confirmed via `probe-preagg-routing.py` (no full-scan of 225M raw).

## Risks
- 225M-row tables without rollup → Trino OOM / proxy 504. **Mitigation:** rollups before any chat exposure; description mandates role_id/date filters.
- `approx_percentile` is non-additive → cannot live in a rollup. **Mitigation:** keep percentile measures off the rollup; expose sum/count there, percentiles only on bounded ad-hoc queries.

## Next steps
Phase 04 (economy) and Phase 05 (chat awareness).
