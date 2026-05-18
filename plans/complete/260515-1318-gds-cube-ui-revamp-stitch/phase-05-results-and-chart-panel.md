# Phase 05 — Results Tab Reorder + Chart as Collapsible Panel

## Context Links

- Mockup results: `plans/reports/research-260515-1254-ui-revamp-stitch-standalone-mockup.md` §"Gap Map → 4. Results"
- Decisions: D10 (don't touch QBv2 tab content beyond restyle)
- Current files (verified):
  - `src/QueryBuilderV2/QueryBuilderResults.tsx` (1274 LOC — owns the grid + table chrome; tab content is rendered upstream)
  - `src/QueryBuilderV2/QueryBuilder.tsx` (144 LOC — owns tab orchestration)
  - `src/QueryBuilderV2/QueryBuilderChart.tsx` (chart tab wrapper)
  - `src/QueryBuilderV2/QueryBuilderChartResults.tsx` (87 LOC — chart render + styling)

## Overview

- **Priority:** P1 (parent layout reordering, plus chart visual restyle)
- **Status:** completed
- **Brief:** Reorder QBv2 tabs so the results-grid is the **first tab**. Pull Chart out of the tab strip into a collapsible `<Panel>` above (or beside) Results. Restyle `QueryBuilderChartResults.tsx` with mockup tokens.

## Key Insights

- QBv2's tab strip lives in `QueryBuilder.tsx` (parent), not `QueryBuilderResults.tsx` (which is the results-grid leaf).
- Mockup tab order: Chart, Table, Pivot, SQL, JSON. **Our adopted order (per user spec):** Results → Pivot → SQL → JSON → REST → GraphQL. Chart is hoisted out of tab strip.
- `QueryBuilderChartResults.tsx` is small (87 LOC) — only wrapper styling changes (KPI cards on top, summary delta, orange line palette from chart-1..5 tokens).
- KPI cards on top of chart: derive from `resultSet.series()[0].series[0]` total + delta vs previous period. If previous-period derivation is non-trivial, ship without delta and document.
- Collapsible chart panel: UI-kit has a `Panel` / `Disclosure` primitive — verify name at step 1; else use antd `Collapse`.

## Requirements

**Functional**
- Tab order in `QueryBuilder.tsx`: **Results, Pivot, SQL, JSON, REST, GraphQL**.
- Results tab is default-active on mount.
- Chart no longer appears as a tab; instead a collapsible `<Panel header="Chart">` mounted above the tab strip (or as a side panel — choose above for vertical scroll simplicity).
- Chart defaults to **collapsed** on first mount (less surprising; opens via header click).
- Chart panel renders existing `<QueryBuilderChartResults>` content.
- Chart visual: KPI cards row on top (1 card per series), then chart canvas with brand-orange primary line, neutral grid, Geist font.
- Chart-type chooser (line / bar / area) reuses existing control if present.

**Non-functional**
- Files stay < 200 LOC; restyle only — no rewrite.
- No regression on rendered data (table, pivot, SQL).
- Build green.

## Architecture

```
QueryBuilder.tsx (modify)
├── <QueryStatePillBar/>                       (from Phase 04)
├── <ChartCollapse>                            NEW wrap
│     └── <QueryBuilderChartResults/>          existing, restyled
├── <Tabs>                                     reordered
│     ├── Tab "Results"  → existing QueryBuilderResults
│     ├── Tab "Pivot"    → existing Pivot tab content
│     ├── Tab "SQL"      → existing QueryBuilderSQL / QueryBuilderGeneratedSQL
│     ├── Tab "JSON"     → existing
│     ├── Tab "REST"     → existing QueryBuilderRest
│     └── Tab "GraphQL"  → existing QueryBuilderGraphQL
```

ChartCollapse = thin wrapper:

```tsx
<Collapse defaultActiveKey={[]} ghost>
  <Collapse.Panel header={<ChartHeader/>} key="chart">
    <QueryBuilderChartResults />
  </Collapse.Panel>
</Collapse>
```

`<ChartHeader>` = label + chart-type chooser (segmented) + collapse toggle indicator.

## Related Code Files

**Modify**
- `src/QueryBuilderV2/QueryBuilder.tsx` — reorder tab children; remove Chart from tabs; insert `<ChartCollapse>` above tab strip
- `src/QueryBuilderV2/QueryBuilderChart.tsx` — if it's the chart-tab wrapper, repurpose into the collapse wrapper OR delete and let `QueryBuilderChartResults` be hoisted directly (decide step 2)
- `src/QueryBuilderV2/QueryBuilderChartResults.tsx` — restyle: tokens for line color (`var(--chart-1)`), grid (`var(--neutral-200)`), font (`var(--font-sans)`); add KPI cards row

**Read for context (do NOT modify)**
- `src/QueryBuilderV2/QueryBuilderResults.tsx` — confirm it remains the Results tab content unchanged
- `src/QueryBuilderV2/QueryBuilderSQL.tsx`, `QueryBuilderRest.tsx`, `QueryBuilderGraphQL.tsx`, `QueryBuilderGeneratedSQL.tsx`

**Create**
- (Optional) `src/QueryBuilderV2/components/chart-kpi-cards.tsx` (~80 LOC) — derives total + (if cheap) delta from `resultSet`

**Delete**
- None — restyle only. If `QueryBuilderChart.tsx` is the chart-tab wrapper, consider deleting after migration; verify no upstream import.

## Implementation Steps

1. Read `QueryBuilder.tsx` (144 LOC) end-to-end. Identify Tabs/Tab strip JSX. Verify tab order today and the prop API of the Tabs primitive used.
2. Read `QueryBuilderChart.tsx`. Decide whether to repurpose it as `<ChartCollapse>` wrapper or delete + hoist `<QueryBuilderChartResults>` directly. Prefer delete if it's only a thin tab adapter.
3. In `QueryBuilder.tsx`:
   - Remove the Chart tab entry.
   - Insert `<ChartCollapse>` above the Tabs block.
   - Reorder children: Results, Pivot, SQL, JSON, REST, GraphQL.
   - Set default-active to "Results".
4. Restyle `QueryBuilderChartResults.tsx`:
   - Replace hard-coded colors with `var(--chart-1)`…`var(--chart-5)`.
   - Apply `font-family: var(--font-sans)` to recharts text props.
   - Apply neutral grid color.
5. Add KPI cards row on top of chart canvas:
   - For each series in `resultSet.series()`, render a card with: series name (small, neutral-500), total value (Geist 600, large), optional delta vs prev period.
   - If previous-period delta is non-trivial: render total only; flag as v2 enhancement.
6. Verify other tabs (Pivot/SQL/JSON/REST/GraphQL) render untouched.
7. `npm run build` + manual smoke: click Results, click each tab in order, expand chart panel, run a query, see KPI cards + orange line.

## Todo List

- [ ] Read `QueryBuilder.tsx` end-to-end; map current tab order
- [ ] Decide fate of `QueryBuilderChart.tsx` (repurpose vs delete)
- [ ] Remove Chart from Tabs; insert `<ChartCollapse>` above
- [ ] Reorder tabs to Results → Pivot → SQL → JSON → REST → GraphQL
- [ ] Set Results as default tab
- [ ] Restyle `QueryBuilderChartResults.tsx` colors + font
- [ ] Implement `chart-kpi-cards.tsx`
- [ ] Manual smoke across all tabs
- [ ] `npm run build` passes

## Success Criteria

- Results is the default tab; user lands on the grid not the chart.
- Chart toggles via Collapse header — collapsed initially, expanded on click.
- Chart renders with brand-orange primary line.
- KPI cards visible above chart canvas.
- No regression in other tabs (SQL/JSON/REST/GraphQL all render).
- Build green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Removing Chart tab breaks a hash-route deep-link to `#chart` tab | Low | Low | If tab keys are persisted in URL, redirect `#chart` → expand the new collapse panel |
| KPI delta calc requires re-querying previous period | High | Low | Ship without delta in v1; add later |
| `QueryBuilderChart.tsx` has side effects we miss (e.g., autosize observer) | Medium | Medium | Repurpose rather than delete if unclear |
| Recharts ignores CSS vars in axis labels | Medium | Low | Pass token values to recharts props directly via `getComputedStyle` helper |
| Collapse open/close animation jitter on first render | Low | Low | Use `defaultActiveKey={[]}` + `destroyInactivePanel={false}` |

## Security Considerations

- None. Visual + layout only.

## Rollback

- Single-file revert per modified file restores prior tab order.

## Migration / Backwards Compatibility

- Existing query URLs continue to work. If tab is encoded as a URL hash and `#chart` is in use, add a translate-once redirect.

## Next Steps

Phase 6 finalises: hide redundant chrome from `QueryBuilderExtras` if pill-bar duplicates it visually, manual smoke pass, before/after screenshots.

## Unresolved Questions

- Are tab keys persisted in URL (hash/query)? If yes, handle `#chart` legacy.
- Should chart be **above** the tabs or **beside** them? Above chosen for vertical-scroll simplicity; revisit in design review.
- Previous-period delta computation — defer to v2 unless `resultSet` already exposes a `compareDateRange` slice.

Status: DONE
