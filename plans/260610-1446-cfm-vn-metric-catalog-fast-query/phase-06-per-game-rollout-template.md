---
phase: 6
title: "Per-game roll-out template"
status: pending
priority: P3
effort: "1.5h"
dependencies: [4, 5]
---

# Phase 6: Per-game roll-out template

# Overview
Capture the cfm_vn process as a repeatable, low-cognitive checklist so other games
(jus_vn, ballistar, cros, …) can be brought to the same bar without re-deriving the design.

## Requirements
- Functional: a doc that, per game, walks: (1) availability+Trino audit, (2) width curation
  vs that game's tables, (3) rollup spec reuse (which cfm rollups port directly vs need the
  game's column mapping), (4) build+verify <2s, (5) seed rebuild.
- Note per-game divergences already known: jus recharge composite-PK + pay_time vs log_date;
  games absent from cube-prod (muaw/ptg/pubg) lack a PK oracle → verify empirically.
- Non-functional: emphasize what is game-agnostic (rollup shapes, ratio classes, canonical
  day dim) vs game-specific (physical columns, schema family etl_/std_/cons_).

## Architecture
Doc-only. Reference the cfm_vn reports as the worked example.

## Related Code Files
- Create: `docs/metric-catalog-per-game-rollout-template.md` (or under plans/ if preferred)
- Read: cfm_vn Phase 1–5 reports

## Implementation Steps
1. Distill the cfm_vn phases into a per-game checklist with the agnostic/specific split.
2. Pre-list each other game's known schema family + caveats (from memory + cube-prod oracle).
3. Leave roll-out execution per game as separate future efforts.

## Success Criteria
- [ ] A new game can be onboarded to the catalog-fast bar by following the doc, no re-design.
- [ ] Known per-game PK/time-dim caveats captured up front.

## Risk Assessment
- Template drift if cfm_vn design changes post-ship → link, don't copy, the spec.

## Next steps
Per-game roll-outs scheduled separately after cfm_vn ships.
