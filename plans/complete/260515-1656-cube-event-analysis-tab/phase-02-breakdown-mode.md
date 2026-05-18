---
phase: 2
title: "Breakdown mode"
status: pending
priority: P1
effort: "2h"
dependencies: [1]
---

# Phase 2: Breakdown mode

## Context Links
- Research §3 "Breakdown — Native, fully supported"
- Research §4.D "Breakdown / Sticky Table" — 0-lift, "Already in QBv2 results table"
- Existing results table: `src/QueryBuilderV2/QueryBuilderResults.tsx`
- Context: `useQueryBuilderContext().query` exposes `{dimensions, measures, filters, ...}`

## Overview

Breakdown mode = explicit re-surfacing of the existing results-grid behaviour, framed as a product-analytics workflow. Reads pill-bar `query.dimensions` + `query.measures[0]`, runs the same Cube query the Results tab runs, and renders a sortable table with measure DESC default. Adds a clear contract: "pick N dimensions in the pill bar; this view ranks rows by the first measure".

## Key Insights

- Zero new query logic. `context.resultSet` is already populated by `runQuery`.
- Difference vs Results tab is **framing**, not data: header explains "Top combinations of {dim list} ranked by {measure}". The table itself reuses the same renderer or a thinner copy.
- Auto-sort by `query.measures[0]` DESC if no `order` set.

## Requirements

**Functional**
- Reads `useQueryBuilderContext().query` + `.resultSet`.
- Displays a contract header: `Breakdown of {measure} by {dim, dim, …}`.
- Renders a table: columns = dimensions + measure; rows sorted by measure DESC.
- Sortable column headers (click to flip order).
- Empty state if no dimensions OR no measure picked: "Add at least one dimension and one measure in the pill bar above."
- Show row count + first-10-rows-of-N hint at bottom.

**Non-functional**
- File < 200 LOC.
- No new deps.
- Reuses existing chart-result rendering helpers where possible.

## Architecture

```
<BreakdownMode/>                    NEW component
├── reads context.query
├── reads context.resultSet
├── if empty → <Empty description="Add ≥1 dim and 1 measure"/>
├── else
│   ├── <Header>Breakdown of <Measure> by <Dim1, Dim2, …></Header>
│   └── <SortableTable rows={resultSet.tablePivot()} sortBy={query.measures[0]} dir="desc"/>
```

Reuse Path: Inspect `QueryBuilderResults.tsx` (1274 LOC) — extract the inner table renderer if cleanly possible; otherwise duplicate a minimal antd `Table` invocation (~50 LOC) to stay under the LOC budget.

## Decisions

- Sort default: `query.measures[0]` DESC.
- Pagination: rely on antd `Table.pagination={{pageSize: 50}}` — no infinite scroll.
- Drill-down: out of scope v1 (no raw-event surface in Cube — see research §5).

## Related Code Files

**Read for context (do NOT modify)**
- `src/QueryBuilderV2/QueryBuilderResults.tsx`
- `src/QueryBuilderV2/context.tsx`

**Modify**
- `src/QueryBuilderV2/analysis/analysis-panel.tsx` — swap placeholder for `<BreakdownMode/>`.

**Create**
- `src/QueryBuilderV2/analysis/breakdown-mode.tsx` (~150 LOC)

## Implementation Steps

1. Read `QueryBuilderResults.tsx` enough to identify the inner table render call (`<Table dataSource=… columns=…/>`). If it's cleanly extractable as a child, import; else duplicate a thinner version.
2. Create `breakdown-mode.tsx`:
   - Pull `query` + `resultSet` + `isLoading` from context.
   - Compute `rows = resultSet?.tablePivot()` or fall back to `[]`.
   - Build column list = `[...query.dimensions, query.measures[0]]`.
   - Wire antd `Table` with `pagination={{pageSize: 50, showSizeChanger: false}}`, default sort by measure DESC.
   - Header above: "Breakdown of <measure-name> by <dim-name(s)>".
3. Mount in `analysis-panel.tsx` replacing the Breakdown placeholder.
4. Manual smoke: pick 2 dims + 1 measure in pill bar, Run, switch to Analysis → Breakdown. Verify table renders, sortable.

## Todo List

- [ ] Locate / extract result-table renderer (or duplicate thin)
- [ ] Create `breakdown-mode.tsx`
- [ ] Replace placeholder in `analysis-panel.tsx`
- [ ] Empty state shows on missing dim/measure
- [ ] Table sorts by measure DESC default
- [ ] `npx vite build` passes

## Success Criteria

- [ ] Mode shows ranked combinations table.
- [ ] Empty state guides user to pill bar when inputs missing.
- [ ] Column sort works.
- [ ] No regression on Results tab.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Table renderer in QueryBuilderResults.tsx too coupled to extract cleanly | Medium | Low | Duplicate thin antd `<Table>` (~50 LOC) — DRY less important than file-size cap |
| `resultSet.tablePivot()` shape varies | Low | Low | Defensive: `const rows = resultSet?.tablePivot?.() ?? []` |
| User expects raw-event drilldown | High | Low | Out-of-scope v1; documented in research §5. Keep header copy focused on aggregates. |

## Security Considerations

None. Read-only render of authorised context data.

## Next Steps

Phases 3 + 4 are independent of this phase and can be tackled in any order.
