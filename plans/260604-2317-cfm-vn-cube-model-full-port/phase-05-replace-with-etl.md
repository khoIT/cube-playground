---
phase: 5
title: Replace With Etl
status: completed
priority: P2
effort: 0.5d
dependencies:
  - 1
  - 2
  - 4
  - 8
---

# Phase 5: Replace With Etl

## Overview
Retire the 4 local hand-built cfm cubes and replace them with kraken's richer `etl_*` equivalents. These are the "supersede" set (distinct from the additive Phase 6 panels). Depends on Phase 8 (guardrail must exist before any `*_etl_*` cube can be safely queried).

## Requirements
- Functional: replacement cubes compile + sample-query under the 31-day guardrail.
- Non-functional: remove dead cubes; update any local references; no orphan views.

## Architecture
Replace map (local hand-built → kraken etl):
- `economy_flow` (`etl_ingame_moneyflow`) → `etl_money_flow`
- `gameplay_match` (`etl_ingame_game_detail`) → `etl_game_detail`
- `onboarding_tutorial` (`etl_ingame_newbietutorial`) → `etl_newbie_tutorial`
- `ordered_event_funnel` (UNION of etl_login/logout/recharge/register) → `etl_login` + `etl_logout` (+ `etl_register` if cfm has it; cfm uses match-based funnels, confirm via inventory)

Note kraken naming: these are bare-ish (`etl_game_detail`) after stripping the `cfm_` prefix → final local names: `etl_game_detail`, `etl_login`, `etl_logout`, `etl_money_flow`, `etl_newbie_tutorial`. These match the `*_etl_*`... NO — local bare names become `etl_game_detail` (no game prefix), so the guardrail regex must also match bare `etl_*` (see Phase 8).

## Related Code Files
- Delete: `cube-dev/cube/model/cubes/cfm/{economy_flow,gameplay_match,onboarding_tutorial,ordered_event_funnel}.yml`
- Create: `cube-dev/cube/model/cubes/cfm/{etl_game_detail,etl_login,etl_logout,etl_money_flow,etl_newbie_tutorial}.yml`
- Grep: `grep -rn "economy_flow\|gameplay_match\|onboarding_tutorial\|ordered_event_funnel" src/ cube-dev/` for references to migrate.

## Implementation Steps
1. Confirm Phase 8 guardrail merged + matches bare `etl_*` names (critical — these tables are 1M–1.3B rows).
2. Fetch + bare-rename each kraken etl cube; Trino-verify table + columns + `max(log_date)` freshness.
3. Write new cube files; delete the 4 hand-built ones.
4. Migrate references: any segment/preset/doc/template pointing at the old cube names (esp. `docs/ordered-funnel-cube-template.md`) → update or note breakage.
5. Sample-query each new etl cube WITH a bounded `log_date` + `user_id`/`playerid` filter (unbounded will be rejected by guardrail — that's expected).

## Success Criteria
- [ ] 4 hand-built cubes deleted; 5 etl cubes created + Trino-verified.
- [ ] No dangling reference to removed cube names in `src/`, `cube-dev/`, `docs/templates`.
- [ ] Bounded sample query returns rows; unbounded query is guardrail-rejected.
- [ ] Freshness of money_flow/game_detail recorded in cube description (stale ~2026-05-01 if confirmed).

## Risk Assessment
- Deleting `ordered_event_funnel` may break a funnel UI/template that assumes its `step_index`/`step_name` shape. Mitigation: grep first; if a consumer exists, keep a thin compatibility funnel or migrate the consumer.
- cfm event tables use `vopenid`/`playeropenid`/`playerid` keys, not `user_id` — the 2-hop bridge (etl.playerid → user_roles.role_id → mf_users.user_id) is defined in the VIEW layer (Phase 7), not the cube. Cubes keep raw keys. Mitigation: don't force a user_id join into the etl cube itself.
- Stale tables return 0 recent rows → E2E sample must use an in-range historical date for those.
