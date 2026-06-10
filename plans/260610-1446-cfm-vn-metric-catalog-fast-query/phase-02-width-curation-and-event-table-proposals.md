---
phase: 2
title: "Width curation + event-table proposals (cfm_vn)"
status: completed
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: Width curation + event-table proposals (cfm_vn)

## Overview
Decide the final cfm_vn catalog: keep/prune the 57, then propose new exploration metrics
grounded in cfm's modeled-but-unexposed event cubes. "Reasonably wide, but real."

## Requirements
- Functional:
  1. Keep/prune verdict per existing metric (prune = broken-ref with no cfm backing, or
     redundant duplicate). Pruning a tier-1/2 metric the user may expect → flag, don't auto-cut.
     **Dedup exact duplicates** (e.g. `revenue` and `gross_bookings` are both
     `recharge.revenue_vnd` — two ids, same number = agent confusion): keep one, alias the
     other (synonyms folded in Phase 5). **Surface any source-choice pick** — where two ids
     back the same concept from different sources (revenue=recharge vs an mf_users equivalent;
     paying_users=recharge vs paying_users_30d=mf_users; arpu=mf_users vs arppu=recharge),
     choosing the canonical is a source-routing decision → present it, never silent.
  2. Propose additions ONLY from cubes confirmed Trino-backed in Phase 1, with a real
     additive measure + day grain. Candidate event cubes: `etl_money_flow` (sink/source
     economy), `etl_lottery_shoot`, `etl_prop_flow`, `etl_room_match_flow`,
     `etl_team_start_match_flow`, `etl_newbie_tutorial`/`etl_newbie_detail` (onboarding funnel),
     `user_gameplay_daily`, `user_devices`/`user_ips` (multi-device/multi-IP).
  3. Each proposal: id, label, domain, formula (measure/ratio), source cube, day dim,
     proposed dimension cuts. No metric without a verified backing column.
- Non-functional: additions must be modelable as additive day-grain measures (Phase-3 friendly).

## Architecture
Introspect candidate event tables' columns (Trino `DESCRIBE` via proxy `/sql`, or read the
cube `sql:` if already modeled). A proposal is valid only if the column exists AND aggregates
additively at day grain.

## Related Code Files
- Read: `cube-dev/cube/model/cubes/cfm/etl_*.yml`, `user_*.yml`, `game_key_metrics.yml`
- Create: `plans/.../reports/cfm-vn-curated-catalog-and-additions-report.md`

## Implementation Steps
1. Apply Phase-1 verdicts: mark prunes (with reason), confirm keeps.
2. Introspect each candidate event cube; list additive day-grain measure candidates.
3. Draft proposals (target ~8–15 additions for breadth without bloat); group by domain.
4. Present curated final list (kept + pruned + added) for user sign-off before Phase 3.

## Success Criteria
- [ ] Final cfm_vn metric list = explicit keep/prune/add, every entry backed by a verified column.
- [ ] Additions span ≥3 new exploration domains (economy, gameplay, onboarding).
- [ ] No proposal references a non-existent column (each cites cube + column).

## Risk Assessment
- Over-widening → bloat + slow pre-agg workload. Cap additions; each must earn a use case.
- Pruning something user expects → surface as a question, never silent cut (review-audit rule).

## Next steps
Final list feeds Phase 3 (design rollups for kept+added) and Phase 5 (seeds).
