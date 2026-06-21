# Phase 2 · Oracle-less audit (muaw, ptg, pubg)

**Priority:** P1
**Status:** pending
**Depends on:** Phase 0 harness

## Overview
muaw, ptg, pubg have NO prod oracle. Audit them against three other yardsticks: (a) the canonical generator config, (b) cfm/jus dev as the de-facto reference for shared cubes, (c) source-independent canonical rules.

## Key insights
- For the 14 canonical cubes, the generator config IS the contract — divergence from it on a canonical cube in these games is a generation defect (drifted hand-edit). For bespoke recharge/etl cubes, only canonical rules + cfm-shape comparison apply.
- These games' payment infra differs (esp. muaw), so revenue-shape divergence may be legitimate — flag, don't assume bug.

## Requirements
- Run `audit:cube-parity` (canonical-rule mode) for {muaw, ptg, pubg}.
- For canonical cubes: diff against the generator's expected emission; any drift = finding (and a generator-vs-handedit conflict to resolve in Phase 5).
- For shared-but-bespoke cubes (recharge): compare measure set + PK strategy against cfm/jus; flag missing additive guards, PK fan-out, time-dim mismatch.
- Apply the full canonical-rule checklist (seed §"Known bug shapes" 1,2,3,7) to every cube.

## Architecture / approach
- One verification pass per game; output `reports/verified-findings-oracle-less-games.md`.
- Each finding tagged `ref_basis: generator|cfm_shape|canonical_rule` so Phase 4 knows how strong the evidence is (generator > cfm_shape > heuristic).

## Related code files
- Read: `cube-dev/cube/model/cubes/{muaw,ptg,pubg}/*.yml`
- Read (reference): `cube-dev/scripts/lib/canonical-cube-config.mjs`, cfm/jus YAMLs
- Create: `reports/verified-findings-oracle-less-games.md`

## Implementation steps
1. Run harness canonical mode for the 3 games.
2. Per game, verify findings; tag ref_basis; assign verdict.
3. Note any canonical-cube drift as a generator-regeneration candidate.

## Todo
- [ ] muaw pass · [ ] ptg pass · [ ] pubg pass
- [ ] canonical-cube drift list (regeneration candidates)
- [ ] verified ledger written

## Success criteria
- Every canonical cube in these games matches the generator contract or has a documented reason.
- Bespoke cubes pass the canonical-rule checklist or have a flagged finding.

## Risks
- Without an oracle, false positives are likelier. Bias toward `flag` not `auto-fix`; resolve ambiguous shape questions with the user (open question #1 in the seed report).

## Next
Verified ledger → Phase 4.
