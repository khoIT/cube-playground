---
phase: 4
title: "Implement cfm_vn semantic layer + verify <2s"
status: completed
priority: P1
effort: "5h"
dependencies: [1, 3]
---

# Phase 4: Implement cfm_vn semantic layer + verify <2s warm

## Overview
Author the rollup YAMLs from the Phase-3 spec, rebuild pre-aggs, and **prove** each catalog
metric serves warm <2s from CubeStore for cfm_vn. This is the first implementation phase.

## Requirements
- **HARD-GATE (red-team): cfm recharge PK must be verified-unique (Phase 1) BEFORE building
  `revenue_daily`.** The rollup dedups measures on the PK; a non-unique PK re-triggers the
  ~800× inflation just fixed for jus. If Phase 1 flagged it fail → fix the PK (composite,
  jus-style) first, then build.
- Functional:
  1. Add/modify rollups per spec (new recharge `revenue_daily` on `recharge_date`; event-cube
     daily rollups; any Class-B conform-into-mart measure).
  2. Restart Cube (`docker restart cube-playground-cube-api-dev` — DEV_MODE=false ⇒ no hot
     reload) and ensure partitions **seal** (not just defined; verify built).
  3. Verify routing by **compiled SQL / `usedPreAggregations`** (not assumption), and measure
     warm wall time per metric's common slice.
- Non-functional: bar = "query **routes to a pre-agg** AND warm <2s on the 2nd identical query
  where the pre-agg is built". Note (red-team): pre-aggs are dormant locally + cold builds
  3.5–15s + local≠prod — so local timing is **indicative**; prod-confirmed separately. Wide-
  window HLL count_distinct merges may not hit 2s — call those out rather than force them.

## Architecture
Edit only `cube-dev/cube/model/cubes/cfm/*.yml`. Follow rollup authoring rules: build_range on
the physical column, additive measures, canonical day time-dim. Use
`cube-dev/scripts/measure-preagg-build.sh` to confirm builds seal. Probe via `:3004` proxy.

## Related Code Files
- Modify: `cube-dev/cube/model/cubes/cfm/recharge.yml` (+ event cubes, mart) per spec
- Read/Run: `cube-dev/scripts/measure-preagg-build.sh`
- Modify: `docs/lessons-learned.md` (only if a new bug shape surfaces)
- Create: `plans/.../reports/cfm-vn-fastquery-verification-report.md`

## Implementation Steps
1. Apply rollup edits per Phase-3 spec (one cube at a time).
2. Restart cube_api; trigger/await pre-agg builds; confirm partitions sealed.
3. For each metric: run common-slice query twice; capture `usedPreAggregations` + warm time.
4. Any miss (still Trino / >2s) → diagnose via compiled SQL (time-dim mismatch? non-additive?
   dim not in rollup?), fix, re-verify. Don't declare pass on count alone — wall time is the bar.
5. Full server + FE test suites green; `tsc --noEmit` clean (no model/regression breakage).

## Success Criteria
- [ ] cfm recharge PK verified-unique (or fixed) BEFORE `revenue_daily` built.
- [ ] Every final cfm_vn metric: warm common-slice query routes to CubeStore AND <2s
      (or documented Class-B blend = two sub-2s rollup queries).
- [ ] ARPDAU on cfm_vn returns correct (non-inflated) revenue + serves from rollup.
- [ ] Partitions verified sealed (not just defined); tests green.
- [ ] Phase-0 resolution harness re-run = no accuracy regression; if ARPDAU query shape
      changed (combined→blend), chat-service query-shape guidance + any golden queries updated.

## Risk Assessment
- Pre-aggs dormant locally (defined ≠ built) — assert `usedPreAggregations`; plain rollup 404s
  if unbuilt. Cold Trino 3.5–15s on first build.
- Restarting only worker not api ⇒ new rollups never route — restart cube_api too.

## Next steps
Green → Phase 5 (seed only metrics proven fast).
