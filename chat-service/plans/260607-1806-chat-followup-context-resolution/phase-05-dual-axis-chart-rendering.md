# Phase 05 — Auto dual-axis rendering for mixed-scale multi-measure charts

## Context links

- User decision 2026-06-07: option B (dual Y axis) for mixed-scale merged charts.
- FE (cube-playground root, NOT chat-service):
  - `src/pages/Chat/components/chart-section-menu.tsx` — `canDualAxis`,
    `toDualAxisSpec`, `numericColumns`, `compatibleChartTypes` ALL EXIST.
  - `src/pages/Chat/components/assistant-chart-section.tsx` — `dual-axis`
    case renders Bar(left axis) + Line(right axis); type is today only
    reachable via the manual chart-type menu ("render-only view type: never
    emitted by the backend/LLM" — `src/api/chat-sse-client.ts:58`).
  - `preferTableView(spec)` — precedent for data-shape-driven initial view.

## Overview

Priority P2. No backend/schema change. When a chart artifact carries one
categorical/time column + ≥2 numeric measure columns whose scales differ by
>10×, default the initial render to the existing dual-axis combo instead of
the LLM-declared single-axis type. Manual menu override still wins.

## Implementation steps

1. New helper in `chart-section-menu.tsx`:
   `preferDualAxis(spec): boolean` —
   `canDualAxis(spec)` AND scale gap: let `m1,m2` = max(|values|) of the two
   numeric columns (99th-percentile-ish via max is fine, data ≤1000 rows);
   return `max/min > 10`. Guard zero/empty columns.
2. In `AssistantChartSection`: when no override is active and
   `preferDualAxis(spec)` and `spec.type` is in the single-axis family
   (`bar|line|area`), render via `toDualAxisSpec(spec)` (same path the menu
   override takes). Implement as a derived default — NOT a state initialiser —
   so the menu's explicit choice (internal/external override) still wins.
3. Chart-type menu must show the active type as `dual-axis` in this state
   (pass the derived active type down — verify `ChartSectionMenu` props).
4. Tooltip/legend labels: confirm `buildLabelMap` covers both measure columns
   (it maps from `artifact.columns` — multi-measure artifacts already carry
   both columns).

## Related code files

- Modify: `src/pages/Chat/components/chart-section-menu.tsx` (helper)
- Modify: `src/pages/Chat/components/assistant-chart-section.tsx` (derived default)
- Tests: `src/pages/Chat/__tests__/assistant-chart-section.test.tsx` +
  menu helper tests if a menu test file exists

## Todo

- [x] `preferDualAxis` helper + unit tests (gap >10× true; ~2× false; 1 numeric col false; series-encoded false)
- [x] Derived default in AssistantChartSection (override still wins)
- [x] Menu reflects derived dual-axis as active
- [x] Component test: 2-measure mixed-scale time series renders left+right YAxis
- [x] tsc + vitest green (FE root)

## Success criteria

The phase-03 merged artifact (matches ~2M vs distinct players ~300K)
auto-renders as dual-axis; switching back to line via the menu works; a
2-measure chart with similar scales (e.g. kills vs deaths) stays single-axis.

## Risk

- **Design-guidelines compliance**: chart colors already use the CHART palette
  — reuse; no new tokens needed.
- Bar+Line combo for a 30-point daily series: bars at 30 categories are dense
  but legible; if ugly in manual verification, switch the dual-axis case to
  Line+Line for time-series category columns (small follow-up, decide on
  sight in phase 04 replay).
- Sibling sessions may be editing FE files — these two chart files are not in
  the current git-status modified set; re-check before editing.
