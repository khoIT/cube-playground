# Phase 4 · cfm_vn Gameplay-Daily Mart (unlocks NHÓM 2)

**Priority:** medium — data-team track, parallel to 2/3.
**Status:** pending. **Gates:** blockedBy 0; independent of FE phases.

## Overview
cfm's NHÓM-2 playbooks (06–12) read raw `etl_*` cubes (`etl_lottery_shoot` ~213M rows, `etl_prop_flow`/`etl_game_detail` large) that are **not cohort-queryable** — and require a multi-hop `playerid → role → user_id` identity bridge. Build a **user-grain daily mart** that collapses these to one row per `user_id × day` and resolves the join once at model time. Until it lands, the registry keeps 06–12 `unavailable`; this phase flips them `available` with **zero frontend change**.

## Why not just rollups
The preagg rollout (`plans/260608-1733-user-behavior-cube-preagg-rollout/`) accelerates **aggregate cohort counts on hot cubes**; it explicitly scopes out row-level/per-user materialization. A per-user rollup on `etl_lottery_shoot` doesn't collapse cardinality. The mart is the prerequisite that makes those cohorts cheap; rollups then sit on top.

## New model (sibling repo `cube-dev/cube/model/cubes/cfm/`)
`user_gameplay_daily.yml` — one row per `user_id × log_date`, pre-joined via identity bridge:
- `ladder_score`, `ladder_level`, `ladder_score_delta`, `rank_position` (from `etl_game_detail`)
- `clan_id`, `clan_rank`, `is_in_clan` (clan membership snapshot)
- `gacha_draws`, `draws_since_ssr`, `pity_progress` per `lottery_box` (from `etl_lottery_shoot`)
- `rare_items_owned`, `set_completion` per limited-set (from `etl_prop_flow`)
- `match_count`, `loss_streak` (from match-flow cubes)
Plus a `user_gameplay_360` view facet to surface in Member-360.

## Related files
- Create (in sibling `cube-dev`): `cube/model/cubes/cfm/user_gameplay_daily.yml`, mart SQL, add facet to `views/cfm/user_360.yml`; register refresh context in `cube/cube.js`.
- Modify: registry `dataRequirements` for 06–12 point at the new mart members (already declared in Phase 0; verify names match).
- Read: `cube-dev/cube/model/cubes/cfm/{etl_game_detail,etl_lottery_shoot,etl_prop_flow}.yml`, `std_ingame_role_recharge` bridge.

## Implementation steps
1. Define mart SQL: bridge `vopenid/playerid → user_id`, aggregate raw events to user×day (bounded incremental build).
2. Add measures/dimensions per condition needs (rank, clan, pity, set completion, loss streak).
3. Pre-agg rollup on the mart (day grain) per preagg-plan pattern (`rollup_lambda` + `union_with_source_data`).
4. Calibrate 06–12 thresholds (Phase-0 runner) against the mart; update spec.
5. Verify availability resolver flips 06–12 → `available` for cfm_vn from live `/meta`.

## Todo
- [ ] `user_gameplay_daily` mart + identity bridge + incremental build
- [ ] mart measures for 06–12 conditions
- [ ] rollup on mart + assert `usedPreAggregations`
- [ ] Member-360 gameplay facet
- [ ] thresholds calibrated; resolver flips cfm NHÓM 2 → available

## Success criteria
- Cohort count for "06 top leaderboard" (rank ≤ 10) returns sub-second from the mart, not a raw-table scan.
- cfm_vn monitor grid shows NHÓM 2 live with no FE change.
- jus_vn unaffected (no such mart) — NHÓM 2 stays `unavailable`.

## Risks
- Identity bridge coverage (vopenid → user_id) gaps → some VIPs miss gameplay rows; measure coverage, document.
- Mart build cost on 213M/1.35B raw rows → incremental + bounded date window; coordinate with data team / Trino capacity.
