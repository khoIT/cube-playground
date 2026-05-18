---
phase: 4
title: "Chart Side-Pane with Resizable Splitter"
status: pending
priority: P2
effort: "6-8h"
dependencies: [3]
---

# Phase 4: Chart Side-Pane with Resizable Splitter [HIGHEST RISK]

## Overview

Move chart out of the Results tab strip into a right-side **resizable** pane next to the results table. Side-by-side layout — Results = primary (left, flex-grow), Chart = secondary (right, resizable via drag splitter, collapsible). Persists pane width to localStorage. Validated: Cube v0.36, Metabase v60, Looker Studio.

**Priority:** P2 · **Status:** Pending · **Risk:** HIGH — `QueryBuilderResults.tsx` is >1000 LOC with antd Tabs + GridTable; re-parenting + splitter integration is the most fragile change in this iteration.

## Key Insights

- D3 locked: width is **resizable**, NOT fixed 30%. Adds drag-handle code (~80-120 LOC).
- Chart currently lives inside Results as a tab → must remove tab and re-mount as sibling pane.
- Pre-flight `package.json` audit: if `react-resizable-panels` (or equivalent) already exists, use it. Hand-roll only if no lib present.
- Fallback plan documented — if splitter integration fails late, ship chart-below-results (serial) instead of side-by-side. Do NOT ship broken layout.

## Requirements

**Functional:**
- Layout grid: `[sidebar] [main content: filter + pill + results] [splitter] [chart pane]`.
- Chart pane: collapsible (collapsed → narrow strip showing expand affordance, ~32px).
- Splitter: vertical drag-handle between results and chart; drag changes both panes' widths.
- Width persists: `localStorage["gds-cube:chart-pane-width"]` as integer px or percent.
- Default width on first visit: 30% of container.
- Collapsed state persists separately: `localStorage["gds-cube:chart-pane-collapsed"]` (boolean).
- Chart tab removed from Results tab strip.

**Non-functional:**
- Splitter constraints: `min 240px`, `max 60% of container`.
- Splitter file < 200 LOC.
- No regression to Analysis tab, GridTable virtualization, pre-aggregation alerts, RequestStatus.

## Architecture

**Data flow:**
```
Container (flex row)
├── QueryBuilderSidePanel  (existing width logic)
├── Main column (flex-grow:1, min-width:0)
│   ├── QueryBuilderFilters (strip from Phase 3)
│   ├── QueryStatePillBar
│   └── QueryBuilderResults (tabs MINUS chart tab)
├── ResizableSplitter (8px drag bar)
└── ChartPane (width = state, collapsible)
    └── QueryBuilderChartResults
```

**Splitter mechanics:**
- Pointer events: `pointerdown` on handle → capture pointer → `pointermove` updates width → `pointerup` releases capture.
- Width state: parent (`QueryBuilderInternals`) owns `chartPaneWidth` + `chartCollapsed`; passes setters to splitter and pane.
- Throttle: `requestAnimationFrame` on pointermove to avoid layout thrash.
- Persist: `useEffect` on width change → debounced 200ms localStorage write.

**Tab-removal audit:**
- Grep `QueryBuilderResults.tsx` for chart tab key (likely a constant like `'chart'` or enum). List every reference (tab definition, conditional render, default active key). Remove all together.
- Verify Analysis tab + Results tab keys unchanged.

## Related Code Files

**Modify:**
- `src/QueryBuilderV2/QueryBuilderInternals.tsx` — restructure root layout to 4-column flex/grid; own `chartPaneWidth` + `chartCollapsed` state.
- `src/QueryBuilderV2/QueryBuilderResults.tsx` (>1000 LOC) — remove Chart tab from tab definitions + any `activeKey === 'chart'` branches. DO NOT refactor other parts.
- `src/QueryBuilderV2/QueryBuilderChartResults.tsx` — wrap in collapsible panel container; render header with collapse/expand button.

**Create:**
- `src/QueryBuilderV2/components/resizable-splitter.tsx` (~80-120 LOC) — pointer-event drag bar. Or thin wrapper around `react-resizable-panels` if dependency exists.

**Read for context:**
- `src/QueryBuilderV2/QueryBuilderChart.tsx` — chart rendering entry; confirm no Tabs dependency.

**Pre-flight:**
- `package.json` — grep for `react-resizable-panels`, `react-split`, `allotment`. Use existing lib if found.

## Implementation Steps

1. **Pre-flight audit:**
   - Grep `package.json` for splitter libs. Record decision: use-lib OR hand-roll.
   - Grep `QueryBuilderResults.tsx` for chart tab key (`'chart'`, `Chart`, enum, etc.). List ALL references with file:line. Confirm Analysis tab unaffected.
   - Read `QueryBuilderInternals.tsx` end-to-end to map current root layout.
2. **Create splitter:** `src/QueryBuilderV2/components/resizable-splitter.tsx`.
   - Props: `onResize(delta: number)`, `orientation: 'vertical'` (only vertical needed).
   - Pointer handlers + rAF throttle + cursor=col-resize + min/max guards.
   - ARIA: `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow`.
   - If using lib: thin wrapper exposing same props.
3. **Add state to `QueryBuilderInternals.tsx`:**
   - `chartPaneWidth` (int px), init from localStorage or 30% of container width (use ref + ResizeObserver for initial measure if needed).
   - `chartCollapsed` (bool), init from localStorage.
   - Debounced localStorage writes via `useEffect`.
4. **Restructure layout:** outer flex row → sidebar / main column (flex-grow:1, min-width:0) / splitter / chart pane (width = `chartCollapsed ? 32 : chartPaneWidth`).
5. **Remove chart tab from `QueryBuilderResults.tsx`:**
   - Drop chart tab definition.
   - Remove chart-key branch in active-tab logic; ensure default `activeKey` falls back to results.
   - Do NOT touch GridTable, Analysis, pre-aggregation alert code.
6. **Update `QueryBuilderChartResults.tsx`:**
   - Wrap content in panel with header: title "Chart" + collapse button (chevron right when expanded, left when collapsed).
   - When collapsed: render narrow strip with vertical "Chart" label + expand affordance only.
7. **Wire splitter:** `onResize(delta)` → `setChartPaneWidth(w => clamp(w - delta, MIN, MAX))`. (Sign of delta depends on which side handle drags from — verify on first run.)
8. **Compile** (`pnpm tsc --noEmit` or project script). Fix type errors.
9. **Manual smoke (HIGH PRIORITY — defer to Phase 5 for full coverage):** drag splitter, collapse pane, reload page, verify Analysis tab still works, run a real query end-to-end.
10. **Fallback trigger:** If splitter integration causes Results table to lose virtualization or chart fails to render → revert to chart-below-results (vertical stack, no splitter). Document in PR.

## Todo List

- [ ] Pre-flight: package.json audit + chart-tab-key grep
- [ ] Read `QueryBuilderInternals.tsx` layout end-to-end
- [ ] Create `resizable-splitter.tsx` (or wrap existing lib)
- [ ] Add chartPaneWidth + chartCollapsed state in Internals
- [ ] Restructure root layout
- [ ] Remove chart tab from Results
- [ ] Wrap ChartResults in collapsible panel
- [ ] Wire splitter to width setter
- [ ] Debounced localStorage persistence
- [ ] Type-check
- [ ] Manual smoke (drag, collapse, reload, query)
- [ ] If fail: execute fallback (vertical stack)

## Success Criteria

- [ ] Chart renders in right-side pane, NOT as a tab.
- [ ] Splitter drags smoothly (no layout jank, rAF-throttled).
- [ ] Min 240px / max 60% width enforced.
- [ ] Collapse button shrinks pane to ~32px strip; expand restores prior width.
- [ ] Width + collapsed state persist across reloads.
- [ ] Analysis tab, GridTable virtualization, pre-aggregation alerts, RequestStatus all unchanged.
- [ ] Splitter file < 200 LOC.
- [ ] TypeScript compiles clean.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Results table loses width responsiveness after layout change | High | High | `min-width:0` on flex child + ResizeObserver in GridTable's parent. Test with narrow chart pane. |
| Hardcoded `activeKey === 'chart'` branches missed during removal | Medium | High | Pre-flight grep ALL references; remove together. Don't ship until grep returns 0 hits. |
| Splitter pointer events conflict with antd Tabs / GridTable handlers | Medium | Medium | `e.stopPropagation()` on splitter pointerdown. Test with active drag while results scrolled. |
| Hand-rolled splitter has cross-browser pointer-event bugs | Medium | Medium | Use `setPointerCapture` (standard, widely supported). Test on Chrome + Safari. |
| Chart pane width persists incorrectly when window resizes smaller | Medium | Low | On window resize, clamp width to current MAX (60% of container) via `useEffect` + ResizeObserver. |
| Splitter integration fails late in implementation | Medium | High | **Fallback:** chart-below-results vertical stack; no splitter. Ship serial layout instead of broken side-by-side. |

**Rollback:** Revert all four files; remove `resizable-splitter.tsx`. localStorage keys harmless if unused.

## Security Considerations

- Pointer-capture is standard browser API; no XSS surface.
- localStorage values are clamped integers; no injection risk.

## Next Steps

Blocked by Phase 3 (filter strip vertical footprint) so results pane sizing math is final. Unblocks Phase 5 smoke test.
