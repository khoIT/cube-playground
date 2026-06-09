# Phase 05 — Prop + lottery rollup marts (07, 11, 12)

**Priority:** P2 · **Status:** ☐ not started

## Overview
07 Rare unlock / 11 Collector FOMO / 12 Gacha bad-luck are `partial` today — sourced from raw `etl_prop_flow` / `etl_lottery_shoot` (per-member drill-down, 31-day guard). Build per-user rollup marts so they become cohort-queryable (`available`).

## Key insight (verified)
- `etl_prop_flow` (table `etl_ingame_propflow`): `events`, `distinct_props`, `total_prop_delta`, `gains/losses`, `prop_id` per event.
- `etl_lottery_shoot` (table `etl_ingame_lotteryshoot`): `pulls`, `ten_pull_count`, `diamond_pulls`, `total_cost/award`.
- Both populated historically (anchor lands the demo). No `draws_since_ssr` / `limited_set_owned_count` columns exist — must be derived in the mart SQL.

## Requirements
- 07: cohort = users who acquired a rare/limited prop within the anchored window. New member `user_prop_daily.rare_acquired_at` (or count) — `event`/`abs` predicate.
- 11: `limited_set_owned_count >= 4` — derived count of distinct limited props owned per user.
- 12: `draws_since_ssr >= 70` — derived per-user pull-streak since last SSR award.

## Architecture
- Create `cube-api/.../cfm_vn/user_prop_daily.yml`: aggregate `etl_ingame_propflow` per user×day →
  `props_acquired`, `distinct_props_owned`, `limited_set_owned_count` (COUNT DISTINCT prop_id WHERE prop in a limited/rare set — needs a rare/limited prop_id allowlist; if none available, approximate "rare" via high `total_weapon_point_delta` / specific prop categories). `rare_acquired_at` = MAX(log_date) of a rare acquisition.
- Create `cube-api/.../cfm_vn/user_lottery_daily.yml`: aggregate `etl_ingame_lotteryshoot` per user →
  `draws_since_ssr` = pulls since last SSR-tier award (derive from award columns; if SSR not flagged, approximate via `total_award_diamond` jackpot threshold or `ten_pull_count` cadence). Document the approximation.
- Registry: repoint 07/11/12 `dataRequirements` to the new cubes; 07 `event` window anchor-relative; 11/12 `abs`. They flip from `partial`→`available`.

## Open data question (resolve before building)
- Is there a **rare/limited prop_id catalog** or an SSR-tier flag in the lottery data? If not, the "rare"/"SSR" definitions are heuristics. Inspect `etl_prop_flow.yml` / `etl_lottery_shoot.yml` dimensions + sample `/load` distinct values. If unresolvable, keep 07/11/12 as `partial` (drill-down) and document — do not fabricate.

## Related code files
- Create: `cube-api/.../cfm_vn/user_prop_daily.yml`, `cube-api/.../cfm_vn/user_lottery_daily.yml`.
- Modify: `server/src/care/playbook-registry.ts` (07/11/12 dataRequirements + predicate members + windows).
- Tests: availability test (07/11/12 → available if marts land); translator test for the new predicates.

## Implementation steps
1. Inspect prop/lottery dimensions + sample values to confirm rare-prop / SSR signals.
2. Build the two rollup YAMLs (trailing slice around anchor for cost).
3. Validate `/meta` + `/load` on a populated anchor day.
4. Repoint registry 07/11/12; restart Cube; sweep; verify cohorts.

## Todo
- [ ] confirm rare-prop catalog / SSR flag (or document heuristic)
- [ ] user_prop_daily.yml + verify
- [ ] user_lottery_daily.yml + verify
- [ ] registry repoint 07/11/12
- [ ] Cube restart + sweep produces cohorts
- [ ] tests

## Success criteria
- 07/11/12 read `available`; sweeps open plausible cohorts on the anchor day (or stay `partial` with documented reason if the rare/SSR signal is missing).
- Cube `/meta` clean; server tests pass.

## Risks
- Rare/SSR definitions are heuristic without a catalog → cohorts may be noisy. Mitigation: surface the heuristic in the playbook description; calibrate sizes in Phase 06; fall back to `partial`.
- These are higher-volume event tables → window cost. Mitigation: bounded date slice + pre_aggregation if slow.

## Security
Read-only; VIP gate preserved.

## Next
Phase 06 — integration + demo verification across all 17.
