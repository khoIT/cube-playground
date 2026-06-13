# Spec — Offer "Scatter" toggle when chart rows carry ≥2 numeric columns

## Problem
`compatibleChartTypes` keeps scatter data-shape-isolated: a category×value chart
(bar/line/area/hbar) never offers a scatter toggle. But when the agent fetched
**two metrics per entity** and charted only one as a bar (e.g. ARPU per country
with `paying_rate` still in the rows), the user has no path to view the
correlation. The chart's data rows already contain ≥2 numeric columns — enough
to build a scatter — but the emitted `encoding` only names one of them.

## Goal
When a category×value chart's underlying rows have ≥2 numeric columns, surface
"Scatter" in the chart-type menu. Selecting it re-encodes (not just re-types)
the spec: pick two numeric columns as x/y, keep the entity column as point label.

Non-goals: changing what the agent emits (already fixed); letting an
agent-emitted scatter toggle to bar (scatter stays isolated when it's the
declared type); multi-axis pickers / UI to choose which columns map to x vs y.

## Design

### Data-shape helpers (`chart-section-menu.tsx`)
- `isNumericColumn(rows, col)`: every row's value is a finite number or a
  finite numeric string (non-empty).
- `numericColumns(rows)`: columns of `rows[0]` that pass `isNumericColumn`.
- `compatibleChartTypes`: in the category×value branch, append `'scatter'` when
  `numericColumns(spec.data).length >= 2`. Order: after pie/donut.

### Re-encode transform (`chart-section-menu.tsx`)
- `toScatterSpec(spec)`: build a scatter spec from a category×value spec.
  - `y` = `encoding.value` if numeric, else `numericColumns()[0]`.
  - `x` = first numeric column ≠ `y`.
  - `encoding = { category: x, value: y }`, `type: 'scatter'`, same `data`/`title`.

### Label robustness (`assistant-chart-section.tsx`)
- `scatterLabelKey`: prefer the first **non-numeric** leftover column (the entity,
  e.g. `country`) over the first leftover — robust when >2 numeric columns exist.
  Reuses `isNumericColumn`.

### Active spec (`assistant-chart-section.tsx`)
- When `overrideType === 'scatter'` and `spec.type !== 'scatter'`, use
  `toScatterSpec(spec)` as the rendered spec; otherwise the existing
  `{ ...spec, type: overrideType }`. Applies to standalone (internal override)
  and embedded/query-artifact-card (external override) paths — both flow through
  `AssistantChartSection`, so no card change needed.

## Files
- `src/pages/Chat/components/chart-section-menu.tsx` — helpers + compatibleChartTypes + toScatterSpec
- `src/pages/Chat/components/assistant-chart-section.tsx` — activeSpec branch + scatterLabelKey
- `src/pages/Chat/__tests__/assistant-chart-section.test.tsx` — unit tests

## Tests
- `isNumericColumn` / `numericColumns`: numeric, numeric-string, mixed, empty.
- `compatibleChartTypes`: category×value w/ ≥2 numeric → includes `scatter`;
  1 numeric → excludes it; series spec unaffected.
- `toScatterSpec`: x=non-value numeric, y=value, leftover non-numeric stays as label.
- `scatterLabelKey`: prefers non-numeric column when >2 numeric columns present.

## Risks
- >2 numeric columns → x/y choice is heuristic (value as y, first other as x).
  Acceptable; user can read both axes from labels. No UI picker (YAGNI).
- Numeric-looking string IDs (e.g. zip codes) could be mis-typed as metrics.
  Low risk in this analytics context (metrics are real numbers); accept.
