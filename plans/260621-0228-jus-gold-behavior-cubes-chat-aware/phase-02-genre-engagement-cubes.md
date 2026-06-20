# Phase 02 — Genre engagement loops (garden_harvest + npc_tour)

**Priority:** P1 (genre-defining, cheap, fresh data) · **Status:** ☐ todo

## Overview
jus's genre signature is a **farming/garden progression loop** and an **NPC intimacy/companion
tour** system. Both are richly populated in the raw `etl_*` tables but have only presence-only
`std_*` marts (feature-DAU, no detail). Build raw-sourced cubes so the diagnose/advise rail can
explain engagement movements specific to this genre — impossible with the cfm match-based model.

## Key insights
- `etl_ingame_garden_farm_crop_harvest` (20.7M rows): `crop_level` is the progression axis
  (peaks at level 11 = 7.5M harvests/wk, 8.4K roles). Keyed on `role_id`.
- `etl_ingame_npc_im_tour` (129K rows): 18 distinct `npc_rel_id`, `is_enter` flag (true/null),
  `role_grade`. The companion/relationship engagement loop.
- **Both only have ~2 weeks of data (2026-06-09→today)** — ship as current-window snapshot cubes;
  disclose the window in the cube description; do NOT add trend/retention measures yet.
- `std_` versions are presence-only → must source from raw `etl_*` for any depth.

## Requirements
- `garden_harvest` cube: grain = harvest event.
  - Dims: role_id, server, log_date(time), `crop_level`(number), country, region.
  - Measures: `harvests` (count), `harvesting_roles` (count_distinct_approx role_id),
    `avg_crop_level` (avg), `max_crop_level` (max), `high_level_harvests` (filtered crop_level>=11).
  - Bridge join role_id→user_roles→mf_users.
- `npc_tour` cube: grain = tour event.
  - Dims: role_id, server, log_date(time), `npc_rel_id`(string), `is_enter`(bool), `role_grade`(number).
  - Measures: `tour_events` (count), `touring_roles` (count_distinct_approx),
    `enter_events` (filtered is_enter=true), `enter_rate` (ratio enter/total), `distinct_npcs` (count_distinct npc_rel_id).
  - Bridge join role_id→user_roles→mf_users.
- Rollups on both (these tables grow; garden is 20M+ and rising) — day/month, lambda union.

## Architecture
```
etl_ingame_garden_farm_crop_harvest ─(role_id)─► user_roles ─► mf_users
etl_ingame_npc_im_tour              ─(role_id)─► user_roles ─► mf_users
```
`is_enter` raw is `'true'`/NULL → expose bool dim via `CASE WHEN is_enter='true' THEN TRUE ELSE FALSE`.

## Related code files
- Create: `cube-dev/cube/model/cubes/jus/garden_harvest.yml`
- Create: `cube-dev/cube/model/cubes/jus/npc_tour.yml`
- Read for pattern: `cube-dev/cube/model/cubes/cfm/etl_lottery_shoot.yml` (raw event + role join + rollup), `cube-dev/cube/model/cubes/jus/etl_prop_flow.yml` (existing jus raw-event cube).

## Implementation steps
1. Confirm `crop_level` / `npc_rel_id` / `is_enter` / `role_grade` value domains (already sampled; re-confirm types).
2. Write `garden_harvest.yml` (raw event, crop_level dim, role bridge join, rollup). Add window-disclosure in description.
3. Write `npc_tour.yml` (raw event, npc/is_enter/grade dims, role bridge join, rollup).
4. Reload dev model; verify queries return rows in current window.

## Todo
- [ ] re-confirm dim domains
- [ ] garden_harvest.yml + join + measures + rollup + window note
- [ ] npc_tour.yml + join + measures + rollup + window note
- [ ] reload + verify both query

## Success criteria
- `garden_harvest.harvests` by `crop_level` returns the level-11-dominant distribution.
- `npc_tour.enter_rate` by `npc_rel_id` returns per-NPC engagement.
- Both join up to `mf_users` (e.g. harvesting_roles segmented by payer status).

## Risks
- 2-week window → chat may over-interpret as a "drop" vs prior empty period. **Mitigation:** description states coverage start; Phase 05 knowledge-seed entry flags window.
- Garden harvest volume is large (7.5M/wk) — query without role/date filter could be heavy. **Mitigation:** rollup + size warning in description (cfm convention).

## Next steps
Phase 05 seeds genre-aware questions ("which crop level stalls retention?", "do NPC-engaged players monetize better?").
