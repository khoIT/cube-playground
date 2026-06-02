---
phase: 5
title: "Cohort retention grid"
status: completed
priority: P2
effort: "2-3d"
dependencies: []
---

# Phase 5: Cohort retention grid

## Overview

Day-N retention heatmap: rows = `installDate` cohorts (typically last 28 days), columns = `D0, D1, D3, D7, D14, D30`, cells = retention % colored by intensity. Single Cube query with rolling-window measure. Renders as `<CohortGrid>` — bespoke but small primitive.

## Requirements

**Functional**
- Cohort dimension: `installDate` (daily) — last 28 cohorts by default, configurable 7/14/28/90.
- Day-N columns: D0, D1, D3, D7, D14, D30 (D0 = cohort size baseline; rest are % of D0).
- Cell color: linear ramp from low (light) to high (saturated) using a single hue per intensity (palette token from `src/theme/tokens.css`).
- Hover tooltip: cohort date, cohort size, retained count, retention %.
- Game-scoped via existing `apply-game-filter`.
- Export current grid as CSV.

**Non-functional**
- Single Cube query (no N+1).
- Grid renders <200ms for 28×6 cells.
- Empty/sparse cohorts (cohort still maturing) render with a stripe pattern, not 0%.

## Architecture

**Cube modeling assumption** (see plan.md unresolved Q4):

```yaml
# Either a dedicated cubes/retention.yml OR pre-aggregation on existing cubes:
measures:
  - name: cohort_size                 # count distinct users on install_date
  - name: retained_d1                 # count distinct users active on install_date + 1
  - name: retained_d3
  - name: retained_d7
  - name: retained_d14
  - name: retained_d30
dimensions:
  - name: install_date, type: time
```

If a retention cube doesn't exist, Phase 5 ships a frontend-only "manual" path that runs 6 parallel queries against an events cube — slower, but unblocks the demo. Document both.

**Frontend pipeline**

```
useCohortGrid({ game, cohortWindow }):
  cubeApi.load({
    measures: ['retention.cohortSize','retention.retainedD1','retention.retainedD3',
               'retention.retainedD7','retention.retainedD14','retention.retainedD30'],
    timeDimensions: [{ dimension: 'retention.installDate', granularity: 'day',
                        dateRange: `last ${cohortWindow} days` }],
    filters: applyGameFilter(game),
  })
  → reshape to { cohorts: [{ installDate, size, d1, d3, d7, d14, d30 }] }
  → compute retention pct per cell
  → mark "not yet mature" cells (e.g. D30 for a 5-day-old cohort)

<CohortGrid rows={cohorts}>
  fixed left column (date + size)
  6 day-N columns, color = intensityRamp(pct)
  CSS grid (no canvas needed at this size)
```

## Related Code Files

- **Create**
  - `src/pages/Liveops/cohort/index.tsx`
  - `src/pages/Liveops/cohort/cohort-grid.tsx`
  - `src/pages/Liveops/cohort/use-cohort-grid.ts`
  - `src/pages/Liveops/cohort/intensity-ramp.ts`
  - `src/pages/Liveops/cohort/export-cohort-csv.ts`
  - `src/pages/Liveops/cohort/cohort-grid.test.tsx`
- **Modify**
  - `src/App.tsx` — register `/liveops/cohort`
  - `src/theme/tokens.css` — add cohort heatmap palette tokens if missing
- **Possibly create (depends on Q4 outcome)**
  - `cube-dev/cube/model/retention.yml` (or wherever YAML lives) — retention cube
- **Reuse (no edit)**
  - `src/shared/game-scoping/apply-game-filter.ts`

## Implementation Steps

1. Decide Cube modeling path (see unresolved Q in plan.md). If cube exists → skip step 2.
2. (Conditional) Write `retention.yml` with 6 measures + `install_date` dim. Coordinate with data eng for warehouse semantics.
3. `intensity-ramp.ts`: pure fn `(pct, max) → cssColor` using token palette.
4. `use-cohort-grid.ts`: load measures, reshape rows, mark not-yet-mature cells.
5. `<CohortGrid>`: CSS grid layout, tooltip on hover, sticky left column.
6. CSV export — flat rows: `installDate, size, d1, d3, d7, d14, d30`.
7. Add cohort window selector (7/14/28/90).
8. Tests: reshape correctness; not-yet-mature masking; intensity ramp monotonic; CSV format.

## Success Criteria

- [ ] `/liveops/cohort` renders 28×6 grid for active game.
- [ ] Cell color reflects retention %; tooltip shows exact numbers.
- [ ] Not-yet-mature cells render with stripe pattern (not 0%).
- [ ] Cohort window selector reruns query.
- [ ] CSV export downloads with correct headers.
- [ ] Game switch refetches.

## Risk Assessment

- **Risk:** retention cube doesn't exist in production schemas.
  **Mitigation:** fallback path = 6 parallel queries; document warehouse SQL the cube would compile to so data eng can productionize.
- **Risk:** large warehouses make D30 queries slow.
  **Mitigation:** rely on Cube preaggregations; if absent, default cohort window to 7 days.
- **Risk:** color ramp non-accessible.
  **Mitigation:** WCAG-AA contrast on text; pattern for not-mature also helps color-blind users; tooltip always carries the exact number.
- **Risk:** "retention" definition contested (active = login? any event? specific event?).
  **Mitigation:** document the chosen definition in `docs/` and surface it in the page header tooltip.
