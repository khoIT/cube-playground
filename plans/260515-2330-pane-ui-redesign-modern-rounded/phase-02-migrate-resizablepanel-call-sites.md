---
phase: 2
title: "Migrate ResizablePanel call sites"
status: complete
priority: P2
effort: "3-4h"
dependencies: [1]
---

# Phase 2: Migrate ResizablePanel call sites

## Overview

Replace the two existing `@cube-dev/ui-kit` `ResizablePanel` usages — left sidebar (`QueryBuilderSidePanel.tsx`) and right chart pane (`components/ChartSidePane.tsx`) — with `AppPaneGroup` + `AppPane` + `AppResizeHandle` from Phase 1. Restructure `QueryBuilderInternals.tsx` to mount the three columns inside one `AppPaneGroup`.

## Requirements

**Functional**
- Sidebar still drag-resizable; size persisted (key carried over or migrated)
- Chart pane still drag-resizable; collapse/expand button still works
- `disableSidebarResizing` prop still renders a fixed-width sidebar
- Min sizes preserved (sidebar ≥ 280px, chart ≥ 280px)

**Non-functional**
- No visual change beyond Phase 1's wrapper styling (deep restyle is Phase 3)
- localStorage migration must be non-destructive (old keys readable as fallback if mismatch)

## Architecture

```
QueryBuilderInternals
  AppPaneGroup (autoSaveId="QueryBuilder:Panes")
    AppPane id="sidebar"    defaultSize=22 minSizePixels=280  maxSize=35
      <QueryBuilderSidePanel/>
    AppResizeHandle
    AppPane id="center"     defaultSize=50 minSize=30
      <RunBandCard><QueryBuilderRunControl/></RunBandCard>
      <QueryStatePillBar/>
      <QueryBuilderToolBarAlerts/>
      <QueryBuilderFilters/>
      <ResultsTabs/>
    AppResizeHandle  (only when chart pane expanded)
    AppPane id="chart"      defaultSize=28 minSizePixels=280  maxSize=45 collapsible
      <ChartSidePane> ... <QueryBuilderChart/> </ChartSidePane>
```

<!-- Updated: Validation Session 1 - use minSizePixels (react-resizable-panels v2) to preserve current 280px floor regardless of viewport width -->
<!-- Updated: Validation Session 1 - center column shape reflects Phase 4 decision: RunControl is its own slim band card above PillBar -->

`minSizePixels` (v2.x API) preserves the existing 280px floor for sidebar and chart, regardless of viewport width. Percent-based mins would let those panes shrink below 280px on a 1024px viewport.

- The two old `ResizablePanel` call sites lose their resize behavior; the resize now lives in the parent `AppPaneGroup`.
- `QueryBuilderSidePanel` keeps its current inner content, but loses the `ResizablePanel`/`Panel` outer wrapper.
- `ChartSidePane` keeps its collapse-toggle button, but the drag handle moves to the parent.

## Related Code Files

- **Modify:** `src/QueryBuilderV2/QueryBuilderInternals.tsx`
- **Modify:** `src/QueryBuilderV2/QueryBuilderSidePanel.tsx`
- **Modify:** `src/QueryBuilderV2/components/ChartSidePane.tsx`

## Implementation Steps

1. **`QueryBuilderInternals.tsx`** — replace the outer `Flex flow="row"` containing sidebar + center + chart with:
   ```tsx
   <AppPaneGroup autoSaveId="QueryBuilder:Panes" direction="horizontal">
     <AppPane id="sidebar" defaultSize={22} minSizePixels={280} maxSize={35}>
       <QueryBuilderSidePanel />
     </AppPane>
     <AppResizeHandle />
     <AppPane id="center" defaultSize={chartCollapsed ? 78 : 50} minSize={30}>
       <CenterColumnContent ... />
     </AppPane>
     {!chartCollapsed && (
       <>
         <AppResizeHandle />
         <AppPane id="chart" defaultSize={28} minSizePixels={280} maxSize={45}>
           <ChartSidePane><QueryBuilderChart onToggle={setIsChartExpanded} /></ChartSidePane>
         </AppPane>
       </>
     )}
   </AppPaneGroup>
   ```
   <!-- Updated: Validation Session 1 - minSizePixels for sidebar+chart, percent-based min only for center -->
   Center pane keeps `minSize={30}` percent — no hard px floor needed (it flexes between sidebar and chart).
   - Pull `chartCollapsed` state out of `ChartSidePane` into `QueryBuilderInternals` (read from localStorage `gds-cube:chart-pane-collapsed`).
   - When collapsed, render a 36px "rail" instead of mounting the chart `AppPane` (preserves current collapsed UX).

2. **`QueryBuilderSidePanel.tsx`** — remove the `ResizablePanel`/`Panel` outer wrapper (both branches: resizing and non-resizing). Replace with a `tasty(Flex)` container that just sets `padding`, `gap`, `border` per existing inner content needs. The new `AppPane` provides the rounded outer shell.
   - If `disableSidebarResizing`: render the same inner content but the parent in `QueryBuilderInternals` should swap to a fixed-width non-resizable layout (see step 4).
   - Delete `sidebarSize` localStorage state; `react-resizable-panels` handles persistence via `autoSaveId`.

3. **`ChartSidePane.tsx`** — strip the `ResizablePanel`. Keep:
   - The collapsed-state rail (36px wide vertical label + expand button)
   - The expanded inner container with header (title + collapse button) and body
   - `collapsed` boolean state via existing localStorage key (no migration needed)
   - Remove `width` state and `CHART_PANE_WIDTH_KEY` — width is now owned by the parent group.

4. **`disableSidebarResizing` branch** — when this prop is true, `QueryBuilderInternals` should render a non-resize-group layout:
   ```tsx
   <Flex flow="row" gap="0" padding="var(--pane-gap)" background="var(--bg-app)">
     <FixedSidebarShell width="315px"><QueryBuilderSidePanel /></FixedSidebarShell>
     <CenterShell flexGrow={1}>...</CenterShell>
     {!chartCollapsed && <ChartShell>...</ChartShell>}
   </Flex>
   ```
   `FixedSidebarShell` / `CenterShell` / `ChartShell` use the same `PaneShell` styles as `AppPane` (extract `PaneShell` to a shared styled-component in Phase 1).

5. **Compile + smoke test**: `npm run typecheck`, then `npm run dev` and visually confirm dragging the boundaries works, sidebar+chart can collapse, sizes survive reload.

## Todo List

- [ ] Lift `chartCollapsed` state to `QueryBuilderInternals`
- [ ] Wire `AppPaneGroup` with 3 `AppPane`s + 1-2 handles depending on collapse state
- [ ] Strip outer `ResizablePanel` from `QueryBuilderSidePanel`
- [ ] Strip outer `ResizablePanel` from `ChartSidePane`; keep collapsed rail
- [ ] Implement `disableSidebarResizing` non-resize fallback
- [ ] Stop reading/writing `QueryBuilder:Sidebar:size` and `gds-cube:chart-pane-width` (autoSaveId="QueryBuilder:Panes" supersedes both). Old keys are orphaned in users' localStorage — **no migration**, no read, no delete. Confirmed in Validation Session 1.
- [ ] `npm run typecheck` clean
- [ ] Manual smoke test: drag sidebar, drag chart pane, collapse chart, reload page, sizes restored

## Success Criteria

- [ ] Three panes render correctly side-by-side
- [ ] Dragging boundaries changes sizes, no jitter
- [ ] Reload restores sizes (`react-resizable-panels` autosave verified in DevTools localStorage)
- [ ] Collapse chart button still hides the chart pane and renders the 36px rail
- [ ] `disableSidebarResizing` route still works (consumers: check usages across `src/`)
- [ ] TypeScript clean, no console errors in dev

## Risk Assessment

- **Lost width preference on first load**: old `gds-cube:chart-pane-width` and `QueryBuilder:Sidebar:size` ignored. Confirmed acceptable (Validation Session 1: one-time reset, autoSaveId starts fresh). Document in commit message.
- **`disableSidebarResizing` callers**: scan for `disableSidebarResizing` in `src/` to ensure all callers still work without the inner `ResizablePanel`.
- **Tasty content inside non-tasty wrapper**: `AppPane` is plain styled-component; `tasty` children still work (tasty produces standard DOM). Watch for height collapse — `min-height: 0` already on `PaneShell`.

## Security Considerations

None. Pure refactor.

## Next Steps

→ Phase 3 restyles the inner content of each pane to match the reference (section headers, padding, search input pill, card aesthetic).
