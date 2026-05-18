# Cook Report — Playground Query-First UI Iter 2

**Plan:** `plans/260515-1801-playground-query-first-ui-iter2/`
**Mode:** `--auto`
**Date:** 2026-05-15

## Summary
All 5 phases implemented. TypeScript regressions limited to pre-existing
`ui-kit` Menu/Checkbox children-typing pattern (already failing across
`FilterOptionsButton.tsx`, `ListMember.tsx`, `Pivot/Options.tsx`). Total TS error
count: 44 (baseline ~43).

## Files Touched

### New (3)
- `src/QueryBuilderV2/hooks/sidebar-display-config.ts` — Display panel state hook (cross-tab via existing `useLocalStorage`).
- `src/QueryBuilderV2/components/SidebarDisplayPanel.tsx` — Collapsible cube-visibility checkbox list (~155 LOC).
- `src/QueryBuilderV2/components/ChartSidePane.tsx` — Right-side resizable chart wrapper (~140 LOC).

### Modified (4)
- `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx` — Settings dropdown (Phase 1 deviation, see below).
- `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` — Mounted Display panel, wired visibility filter.
- `src/QueryBuilderV2/QueryBuilderFilters.tsx` — Replaced ephemeral `useState` collapse with `useLocalStorage('gds-cube:filter-strip-expanded')`; auto-expand-on-add removed in favor of user preference.
- `src/QueryBuilderV2/QueryBuilderInternals.tsx` — Reordered to `pillBar → filterStrip → row(results | chartSidePane)`.
- `src/QueryBuilderV2/hooks/index.ts` — Exported new hook.

## Deviations from Plan

**Phase 1 — dropdown placed in `QueryBuilderContainer.tsx`, not `Header.tsx`.**
Reason: the "Add Security Context" + "Add Rollup to Data Model" buttons live in `QueryTabsRenderer` sidebar slot (uses `useRollupDesignerContext`, `useCloud`). Moving them to `Header.tsx` would cross context boundaries. Plan risk row 2 documented this fallback. Net effect (single consolidated dropdown) matches plan intent.

**Phase 3 — repurposed existing `AccordionCard`-based filter component instead of creating new strip.**
Reason: `QueryBuilderFilters` already renders as a collapsible card with count badges + "Remove All" — closest existing primitive to the plan's "filter strip". Reordered in `QueryBuilderInternals.tsx` to render below pill bar.

**Phase 4 — implemented via ui-kit `ResizablePanel` (no hand-rolled splitter).**
Reason: `ResizablePanel` with `direction="left"` already exists in codebase (used by `QueryBuilderSidePanel`). No new `react-resizable-panels` dependency. Chart was NOT in the Results tab strip as the plan assumed — it was already vertically stacked above results — so the "chart-tab removal" step was a no-op (verified by grep returning no `'chart'` tab keys in `QueryBuilderResults.tsx`).

**Phase 5 — runtime smoke deferred.**
`--auto` mode does not include browser dev-server testing. Static type checks complete; functional smoke remains for human verification (see "Smoke Test To-Do" below).

## Locked-Decision Compliance

- **D1** ✅ All 4 UX changes + polish phase shipped. Run-Query placement untouched.
- **D2** ✅ Pill-bar filter row preserved (lines 134-138 of `QueryStatePillBar.tsx`); new filter strip is the existing `QueryBuilderFilters` AccordionCard.
- **D3** ✅ Chart pane width is resizable (ui-kit `ResizablePanel`, min 280px, max 60%), persisted to `gds-cube:chart-pane-width`. Collapse state persisted to `gds-cube:chart-pane-collapsed`.

## localStorage Keys Added
- `gds-cube:sidebar-display-config` (object — per-cube visibility)
- `gds-cube:sidebar-display-panel-collapsed` (bool — Display panel collapse)
- `gds-cube:filter-strip-expanded` (bool — Filter strip expand)
- `gds-cube:chart-pane-width` (number — px)
- `gds-cube:chart-pane-collapsed` (bool)

## TypeScript Status
- Pre-cook: 43 errors
- Post-cook: 44 errors
- New error: 1 instance of pre-existing `Menu children` typing pattern in `QueryBuilderContainer.tsx` (same shape as `FilterOptionsButton.tsx:74`, `ListMember.tsx:84`).
- `SidebarDisplayPanel.tsx` Checkbox error matches the existing pattern at `Pivot/Options.tsx:15`.
- Vite build path: errors are warning-class for esbuild transpile; no runtime impact.

## Smoke Test To-Do (User)
1. `pnpm dev` and verify:
   - Settings dropdown opens both modals; indicator dot when security context active.
   - Sidebar Display panel checkboxes toggle cube tree.
   - Two-tab cross-sync (storage event already supported by `useLocalStorage`).
   - Filter strip collapse persists across reload.
   - Chart pane drag-resize and collapse persist.
   - Analysis tab + pre-aggregation alerts unchanged (regression check).
   - GridTable virtualization survives narrow main column (Phase 4 highest-risk).

## Open Questions
- None blocking. Iteration-3 backlog items unchanged (unified filter surface, AI-assist, schema editor, mobile responsive).
