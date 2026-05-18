---
phase: 3
title: "Distribution mode"
status: pending
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 3: Distribution mode

## Context Links
- Research §2 "Distribution / Histogram Analysis"
- Research §3 "Distribution — Natively feasible, with caveats"
- Research §4.C "Distribution / Histogram Analysis" — implementation effort Low–Medium
- recharts BarChart docs: https://recharts.org/en-US/api/BarChart

## Overview

Distribution mode bins one numeric measure into N buckets (default 10) and renders a histogram. Bucketing is **client-side** — Cube returns the raw measure grouped by an existing dimension (or by `user_id` if available), the UI buckets in JavaScript with `Math.floor(value / binWidth)`. Optional grouping dimension stacks the histogram.

## Key Insights

- "Out of the box" → no YAML edits. So we cannot ask Cube for a computed bucket dimension. We MUST do client-side bucketing.
- Performance floor (research §7 Q4): O(N) browser bucketing. For >10K rows expect noticeable lag. Cap at 10K rows in v1 and show a warning if exceeded.
- recharts BarChart accepts `[{bucket: '0-100', count: 42}, …]` array.
- Bucket-width = `(max - min) / binCount`. Edge case: all values equal → single bin labeled with the value.

## Requirements

**Functional**
- Inputs: measure picker (single-select from `usedCubes`' numeric measures), bin count input (default 10, min 2, max 50), optional grouping dimension (single-select).
- Fetch flow:
  - If grouping dim picked: query `{measures: [measure], dimensions: [groupDim, identifyDim]}` where `identifyDim` is the highest-cardinality dimension (e.g. user id) — falls back to none if absent.
  - Else: query `{measures: [measure], dimensions: [identifyDim]}`.
  - Client buckets the result rows by measure value into `binCount` buckets.
- Renders recharts BarChart (vertical bars). If grouped, stacked bars per group.
- Below chart: small stat row — min, max, mean, median, total count.
- Empty state if no measure picked.
- Warning banner if row count exceeds 10,000 (degraded perf).

**Non-functional**
- Files < 200 LOC each.
- Single Cube query per render. Re-run only on input change (debounced 300 ms).
- Build green.

## Architecture

```
<DistributionMode/>
├── <DistributionInputs onChange={setInputs}/>
│   ├── measure-select
│   ├── bin-count InputNumber
│   └── group-dim-select (optional)
├── effect: runs cubeApi.load() on input change
├── client-side bucket(rows, binCount) → {bucket, count}[]
└── <recharts.BarChart data={bins}/>
    └── <stat-row min/max/mean/median/n/>
```

Helpers:
- `bucket(values: number[], binCount: number) => Bin[]` — pure function, testable.
- `summarise(values: number[]) => {min, max, mean, median}` — pure.

## Related Code Files

**Modify**
- `src/QueryBuilderV2/analysis/analysis-panel.tsx` — swap placeholder.

**Create**
- `src/QueryBuilderV2/analysis/distribution-mode.tsx` (~150 LOC) — orchestrator + chart.
- `src/QueryBuilderV2/analysis/distribution-bucket.ts` (~80 LOC) — pure helpers: `bucket`, `summarise`.

## Implementation Steps

1. Read `context.cubeApi.load` signature in `hooks/query-builder.ts:269` to confirm the promise shape.
2. Build `distribution-bucket.ts`:
   - `bucket(values, binCount)`: compute min/max, binWidth, allocate counters, return `[{bucket: '0-99.9', start, end, count}]`.
   - Handle `min === max` (single bin) + `values.length === 0` (empty array).
   - `summarise(values)`: standard min/max/mean/median.
3. Build `distribution-mode.tsx`:
   - Inputs section (antd Select + InputNumber).
   - On change, fire `cubeApi.load(query)` with 300 ms debounce.
   - On promise resolve, extract row values for selected measure (via `resultSet.rawData()`), bucket, render.
   - Mount recharts `<BarChart><XAxis dataKey="bucket"/><YAxis/><Bar dataKey="count" fill="var(--chart-1)"/></BarChart>`.
   - Below chart: stat row.
4. Mount in `analysis-panel.tsx`.
5. Manual smoke: pick a numeric measure, see histogram. Change bin count. Add grouping dim, verify stacked.
6. `npx vite build`.

## Todo List

- [ ] Verify `cubeApi.load` signature
- [ ] Implement pure `bucket` + `summarise` helpers
- [ ] Build inputs section (measure, bin count, optional group)
- [ ] Wire debounced query
- [ ] Render BarChart + stat row
- [ ] Warning banner over 10K rows
- [ ] Empty state on no measure
- [ ] `npx vite build` passes

## Success Criteria

- [ ] Histogram renders for any numeric measure.
- [ ] Bin count input live-updates chart.
- [ ] Grouped (stacked) histogram works.
- [ ] Stat row matches computed values.
- [ ] Warning shown for large datasets.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cube doesn't return one row per entity (already grouped) | High | Medium | Default behaviour will bucket on the aggregated value, which is what the user picked — clarify in helper text under measure-select |
| Browser bucketing slow at 10K+ rows | Medium | Low | Cap warning + suggest narrower filters |
| Filter changes in pill bar should propagate | High | Medium | Read pill-bar `query.filters` from context, merge into our load call |
| Picking a non-numeric measure | Medium | Low | Filter measure list to `meta.type === 'number'` candidates only |

## Security Considerations

None. Read-only; uses authorised cubeApi from context.

## Next Steps

Phase 4 is independent and can be developed in parallel with this phase by a separate dev (no shared files).
