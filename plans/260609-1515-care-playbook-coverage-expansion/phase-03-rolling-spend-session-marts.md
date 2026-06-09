# Phase 03 — Rolling spend/session marts (03, 04, 15)

**Priority:** P1 (high value) · **Status:** ☐ not started

## Overview
03 Spend spike / 04 Spend drop / 15 Session-time drop are per-member rolling ratios. With the trigger engine deferred, push the rolling math into Cube/Trino SQL: new cubes expose per-user rolling aggregates **as of a date**, so the playbook predicate is a plain cohort filter and a daily sweep is enough.

## Key insight
`user_recharge_daily` (std mart, fresh) has `revenue_vnd`+`log_date`; `active_daily` has `online_time_sec`+`log_date`. A window function over these per user yields `revenue_1d/7d/30d_avg` and `session_7d/30d_avg` + the spike/drop ratio — no app-side state.

## Requirements
- New cfm_vn cubes exposing per-user, per-day rolling measures + ratio dimensions.
- 03 predicate: `spike_ratio >= 3` (revenue_1d vs revenue_30d_avg). 04: `drop_ratio < 0.3` (revenue_7d vs revenue_30d_avg). 15: `session_ratio < 0.4` (session_7d vs session_30d_avg).
- Cohort filters bound to the anchor day (`log_date = anchor`) so daily sweep returns "today's" spike/drop set.
- VIP-base gate still applies (sweep ANDs `mf_users.ltv_total_vnd >= floor`).

## Architecture
- Create `cube-api/cube/model/cubes/cfm_vn/user_recharge_rolling.yml`:
  `sql:` (not sql_table) = window query over `std_ingame_user_recharge_daily` partitioned by `user_id` ordered by `log_date`:
  - `revenue_1d` = that day's revenue; `revenue_7d` = SUM over 7d; `revenue_30d_avg` = AVG daily over 30d.
  - dims: `user_id`, `log_date`, `spike_ratio` (revenue_1d / NULLIF(revenue_30d_avg,0)), `drop_ratio` (revenue_7d_avg / NULLIF(revenue_30d_avg,0)).
  - join many_to_one → `cfm_mf_users` for the VIP gate + identity.
- Create `cube-api/cube/model/cubes/cfm_vn/user_active_rolling.yml`: same shape over `std_ingame_user_active_daily` → `session_7d_avg`, `session_30d_avg`, `session_ratio`.
- These are aggregate marts (no raw-etl 31-day guard); still scope queries by `log_date = anchor` for cohort size + speed.
- Registry: repoint 03/04 `dataRequirements`→`user_recharge_rolling.*`, predicate kind `abs` on `spike_ratio`/`drop_ratio` (drop the `ratio`/trigger evalMode so the sweep runs them). 15 → `user_active_rolling.*`.

## Related code files
- Create: `cube-api/.../cfm_vn/user_recharge_rolling.yml`, `cube-api/.../cfm_vn/user_active_rolling.yml`.
- Modify: `server/src/care/playbook-registry.ts` (03/04/15 dataRequirements + predicate + evalMode membership not trigger).
- Verify: `server/src/care/playbook-merge.ts` / availability path treats these as membership (cohort) playbooks.
- Tests: registry availability test (03/04/15 → available); a translator test for the `abs`-ratio predicate.

## Implementation steps
1. Write the two rolling YAMLs; validate via Cube `/meta` (members appear) + `/load` (non-empty for a known anchor day).
2. Tune the window SQL for Trino (window funcs, NULLIF guards, date casts mirroring `log_date` TIMESTAMP cast pattern).
3. Repoint registry 03/04/15; remove their `trigger` classification so the sweep evaluates them.
4. Restart the local Cube serving instance (DEV_MODE off = no hot-reload for new cubes; restart cube_api + worker).
5. Sweep cfm_vn; confirm 03/04/15 produce plausible cohorts at the anchor day.

## Todo
- [ ] user_recharge_rolling.yml + /load verify
- [ ] user_active_rolling.yml + /load verify
- [ ] registry repoint 03/04/15 (membership, not trigger)
- [ ] Cube restart + sweep produces cohorts
- [ ] tests

## Success criteria
- 03/04/15 read `available`; a sweep opens a non-empty, sane-sized cohort for each (anchor day).
- Ratios behave: spike cohort ⊂ high recent spenders; drop cohort ⊂ recently-declining.
- Server + cube `/meta` clean.

## Risks
- Window query cost over full history. Mitigation: restrict the SQL to a trailing ~35-day slice around the anchor (enough for 30d windows) or a `WHERE log_date >= anchor-35d`.
- New-cube hot-reload: local Cube needs a restart (per lessons-learned: serving instance must restart for new rollups/cubes).
- Ratio thresholds (3 / 0.3 / 0.4) may need calibration → defer to Phase 06 cohort-size review.

## Security
Read-only; VIP gate preserved. No new PII columns beyond existing recharge/active.

## Next
Phase 04 (gameplay/clan) — larger new mart from raw etl_game_detail.
