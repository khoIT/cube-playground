# Phase 04 — Gameplay + clan daily mart (06, 08, 09, 10, 17)

**Priority:** P1 (highest unlock count) · **Status:** ☐ not started

## Overview
Five playbooks need ladder rank + clan membership, which the registry expects on a non-existent `user_gameplay_daily` cube. The source columns exist in raw `etl_game_detail` (table `cfm_vn.etl_ingame_game_detail`). Build one per-user, per-day aggregated mart so these become cohort-queryable (and free of the raw-etl 31-day guard).

## Key insight (verified on Trino)
`etl_game_detail` carries `ladder_score`, `ladder_level`, `max_ladder_score`, `total_ladder_score_delta`, **`clan_id`**, `clan_name`, `total_gain_clan_activity`, `wins`, `total_kills`. Populated Dec'25 (2.0M players), Mar'26 (1.0M), May'26 (56k) — anchor (Phase 01) lands the demo on a populated day.

## Requirements
- New cube `user_gameplay_daily` (cfm_vn): per user × day, exposing the members the registry references plus rank/clan deltas.
- Members to satisfy registry: `ladder_rank` (06,09), `ladder_rank_drop_48h` (08), `clan_rank` + `clan_rank_changed_at` (10), `clan_id` + `clan_left_at` (17). Also `limited_set_owned_count` is Phase 05 (prop) — not here.
- 06 `ladder_rank <= 10`; 09 `ladder_rank == 1`; 08 `ladder_rank_drop_48h > 5`; 10 clan_rank change in last 48h; 17 clan_left in last 48h.

## Architecture
- Create `cube-api/cube/model/cubes/cfm_vn/user_gameplay_daily.yml`:
  `sql:` window/aggregate query over `etl_ingame_game_detail` grouped by `user_id (playerid/roleid→user_id), log_date`:
  - `ladder_score` = MAX(ladder_score) that day; `ladder_rank` = global rank via `RANK() OVER (PARTITION BY log_date ORDER BY ladder_score DESC)` (top-leaderboard semantics).
  - `ladder_rank_drop_48h` = rank(t) − rank(t−2d) per user (window LAG over date).
  - `clan_id`, `clan_name`; `clan_rank` if derivable (else clan activity rank); `clan_rank_changed_at` / `clan_left_at` = snapshot-diff dates (clan_id present→absent, or rank change) via LAG.
  - join many_to_one → `cfm_mf_users` (VIP gate + identity `user_id`).
- Identity: confirm `etl_game_detail` keys (`playerid`/`roleid`) map to `mf_users.user_id` (check `resolveIdentityField` + existing `user_game_detail_panel` join). If mapping needs `user_roles`/`map_*`, join through it in the SQL.
- Registry: repoint 06/08/09/10/17 `dataRequirements` from `user_gameplay_daily.*` (already named that) — once the cube exists, names match and they flip to `available`. Adjust 08/10/17 windows to anchor-relative `last 48 hours` (≤31d, fine on aggregate mart).

## Related code files
- Create: `cube-api/.../cfm_vn/user_gameplay_daily.yml`.
- Modify: `server/src/care/playbook-registry.ts` (verify member names match the new cube; confirm windows expander-supported).
- Verify: `server/src/services/resolve-identity-field.ts` resolves identity for the new cube.
- Tests: availability test (06/08/09/10/17 → available); translator test for the rank predicates.

## Implementation steps
1. Confirm playerid/roleid→user_id mapping (inspect `user_game_detail_panel.yml` + `user_roles.yml`).
2. Write the aggregate SQL (ladder rank via window; 48h deltas via LAG; clan snapshot diff). Restrict to a trailing slice around the anchor for cost.
3. Add the cube YAML; validate `/meta` + `/load` for a populated anchor day (non-empty ladder_rank, clan_id).
4. Repoint/verify registry member names + windows; ensure these are membership (cohort) playbooks.
5. Restart Cube serving instance; sweep cfm_vn; verify 5 cohorts.

## Todo
- [ ] identity mapping confirmed
- [ ] user_gameplay_daily.yml (rank + 48h delta + clan diff)
- [ ] /meta + /load verify on anchor day
- [ ] registry member/window verify (06/08/09/10/17)
- [ ] Cube restart + sweep produces 5 cohorts
- [ ] tests

## Success criteria
- 06/08/09/10/17 read `available`; sweep opens non-empty cohorts on the anchor day.
- `ladder_rank == 1` (09) cohort is tiny (top players); `<=10` (06) small; clan-change cohorts plausible.
- Cube `/meta` clean; server tests pass.

## Risks
- `ladder_rank` is a derived global rank — expensive window over many rows. Mitigation: rank only within VIP-gated subset or a bounded date slice; pre_aggregation if needed.
- Identity mapping (playerid vs user_id) wrong → empty/zero cohorts. Mitigation: validate join against `user_game_detail_panel` before shipping.
- Clan rank may not be directly modeled — if absent, approximate 10 via `total_gain_clan_activity` delta or defer 10 (still ship 06/08/09/17).

## Security
Read-only; VIP gate preserved. No new PII beyond gameplay aggregates.

## Next
Phase 05 — prop/lottery rollups (07/11/12).
