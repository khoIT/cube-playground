---
phase: 4
title: "Chart panel controls"
status: complete
priority: P2
effort: "2h"
dependencies: [1]
---

# Phase 4: Chart panel controls

## Overview

Add Pivot/Code header controls and a Line/Bar/Area/Table segmented toggle to the chart side pane. Plumbing exists in context (`chartType`, `setChartType`, `pivotConfig`, `updatePivotConfig`, `VizardComponent`); this phase rebuilds the UI.

## Requirements

- ChartSidePane header (when expanded): "Chart" title left + Pivot button + Code button right.
- Body top: segmented chart-type toggle — Line | Bar | Area | Table. Active state in brand orange, others ghost.
- Body bottom: existing chart rendering area.
- Pivot button opens existing PivotAxes/PivotOptions dialog (from `./Pivot`).
- Code button opens existing `VizardComponent` (from context).

## Architecture

Current `QueryBuilderChart` is a tasty/ui-kit `AccordionCard` with internal chart-type Radio buttons and dialogs. This phase:

1. Strip the AccordionCard wrapper from `QueryBuilderChart` (the parent `ChartSidePane` already provides chrome).
2. Extract the chart-type Radio.Group into a new `ChartTypeToggle` segmented component.
3. Lift the Pivot dialog trigger + Code button into `ChartSidePane` header right-slot.

Component sketch:

```
<ChartSidePane>
  <Header>
    <Title>Chart</Title>
    <Right>
      <PivotTriggerButton />   ← opens PivotAxes/PivotOptions
      <CodeButton />           ← opens VizardComponent
      <CollapseButton />       ← existing
    </Right>
  </Header>
  <Body>
    <ChartTypeToggle value={chartType} onChange={setChartType} />
    <ChartCanvas>{chart}</ChartCanvas>
  </Body>
</ChartSidePane>
```

## Related Code Files

- Modify: `src/QueryBuilderV2/components/ChartSidePane.tsx`
  - Accept `chartType`, `onChartTypeChange`, `pivotConfig`, `onPivotChange`, `VizardComponent`, `apiToken`, `apiUrl` props (lifted from `QueryBuilderChart`)
  - Render Pivot + Code buttons in header right-slot
  - Render `ChartTypeToggle` above the children prop
- Create: `src/QueryBuilderV2/components/chart-type-toggle.tsx`
  - Segmented toggle styled per spec: brand orange active state, neutral inactive
  - Props: `value: 'line' | 'bar' | 'area' | 'table'`, `onChange: (v) => void`
  - Icons: Line / Bar / Area / Table (Lucide or ant-design)
- Modify: `src/QueryBuilderV2/QueryBuilderChart.tsx`
  - Remove internal AccordionCard, Header, Radio.Group, Dialog triggers
  - Keep only the chart rendering body (calls `<QueryBuilderChartResults />`)
  - Export the chart body as a clean child of `ChartSidePane`
- Modify: `src/QueryBuilderV2/QueryBuilderInternals.tsx`
  - Wire `ChartSidePane` with the lifted props from context
  - Existing `chartCollapsed` state stays

## Implementation Steps

1. Create `chart-type-toggle.tsx`:
   ```tsx
   const Group = styled.div`
     display: inline-flex;
     padding: 2px;
     border-radius: 8px;
     background: var(--neutral-100);
     gap: 2px;
   `;
   const Segment = styled.button<{ $active: boolean }>`
     display: inline-flex;
     align-items: center;
     gap: 6px;
     padding: 6px 10px;
     border: 0;
     border-radius: 6px;
     background: ${p => p.$active ? 'var(--brand)' : 'transparent'};
     color: ${p => p.$active ? 'var(--text-on-brand)' : 'var(--text-secondary)'};
     font: 500 12px var(--font-sans);
     cursor: pointer;
     &:hover { background: ${p => p.$active ? 'var(--brand)' : 'var(--neutral-200)'}; }
   `;
   ```
2. Read `QueryBuilderChart.tsx` fully to identify dialog state + pivot/code triggers.
3. Lift Pivot/Code button JSX up to `ChartSidePane` header right-slot. Use ui-kit `DialogTrigger` for the Pivot dialog and the existing `VizardComponent` invocation for Code.
4. Strip AccordionCard / Radio.Group from `QueryBuilderChart`. Leave only `QueryBuilderChartResults` body.
5. In `QueryBuilderInternals.tsx`, fetch chart context (`chartType`, `setChartType`, etc.) and pass to `ChartSidePane` props.
6. Run `npm run typecheck` and `npx vite build`.
7. Visual check: Pivot click opens dialog; Code click opens Vizard; chart-type segments switch chart type and persist via existing `setChartType`.

## Success Criteria

- [ ] Header shows: "Chart" title left + Pivot + Code + Collapse buttons right
- [ ] Below header: segmented Line/Bar/Area/Table toggle, active state in brand orange
- [ ] Switching segments updates chart immediately
- [ ] Pivot button opens existing PivotAxes/PivotOptions dialog
- [ ] Code button opens existing VizardComponent
- [ ] Collapsed state still shows the vertical "Chart" rail (unchanged)
- [ ] `npx vite build` clean

## Risk Assessment

- **AccordionCard removal might break tests / qa hooks** — search for `qa="ChartCard"` or similar and update.
- **VizardComponent invocation** — currently inside `QueryBuilderChart`. Lifting it changes when it mounts/unmounts. Confirm it doesn't lose internal state (most likely it's a controlled trigger; safe).
- **Pivot dialog state** — if the dialog state lives in `QueryBuilderChart` local hooks, lift those too.
- **Existing `isExpanded` localStorage key** (`QueryBuilder:Chart:expanded`) is currently used for chart "expand below results" — now obsolete since chart lives in side pane. Decision: leave the key untouched (zero risk), or remove `isExpanded` from `QueryBuilderChart` entirely. **Recommended: remove `isExpanded` logic** since chart side pane has its own `chartCollapsed` state.

## Security Considerations

None.

## Next Steps

→ Phase 5 polishes the results card (independent — can run after Phase 4).
