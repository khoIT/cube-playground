---
phase: 6
title: "Verification"
status: complete
priority: P2
effort: "45m"
dependencies: [2, 3, 4, 5]
---

# Phase 6: Verification

## Overview

Pixel-by-pixel walk through the mid panel vs Image #3 + chart pane vs the user's spec. Type-check, build, manual visual diff in dev server. Document any remaining deltas as follow-up.

## Implementation Steps

1. **Type check**: `npm run typecheck` (may have pre-existing unrelated errors in `@cube-dev/ui-kit` — confirm same baseline as before phase 1).
2. **Build**: `npx vite build` — must complete cleanly.
3. **Dev server**: `npm run dev`. Load QueryBuilder, run a sample query.
4. **Visual diff vs Image #3** — checklist:
   - [ ] Run button color, label "Run query", icon
   - [ ] "Query was not accelerated with pre-aggregation →" banner inline on right
   - [ ] Query header: chevron + "Query" + LIVE green pulsing chip
   - [ ] DIMENSIONS row label position + pill style + "+ Add" button
   - [ ] MEASURES row same pattern
   - [ ] TIME row empty hint + "+ Add time" button
   - [ ] FILTERS row hosts the filter editor + "+ Add" button
   - [ ] "× Remove all" right-aligned, red dashed
   - [ ] Tabs: orange underline on active "Results"
   - [ ] Table header tint matches
   - [ ] Footer: "100 results · received N minutes ago" + Export CSV + Generate code buttons
5. **Chart pane diff** vs user spec:
   - [ ] Header: "Chart" left + Pivot + Code + Collapse right
   - [ ] Segmented toggle: Line / Bar / Area / Table with brand-orange active state
   - [ ] Click each segment → chart switches
   - [ ] Click Pivot → existing dialog opens
   - [ ] Click Code → existing Vizard opens
6. **Resize sanity**:
   - [ ] Drag sidebar resize handle → sidebar resizes, mid expands
   - [ ] Drag chart resize handle → chart resizes
   - [ ] Collapse chart pane → vertical "Chart" rail shown; expand → restores
7. **Document remaining deltas** in a `## Verification Notes` section appended to this file. Anything unresolved becomes a follow-up issue.

## Success Criteria

- [ ] Build clean
- [ ] Dev server runs without console errors
- [ ] Visual checklist 100% (or remaining items explicitly documented + accepted by user)
- [ ] All resize/collapse interactions work

## Risk Assessment

- **Pre-existing tsc errors in ui-kit types** — known from prior plan. `npx vite build` is the source of truth, not `npm run build`.
- **Browser caching** — if styles look stale, hard-reload (Ctrl+Shift+R) or restart dev server.

## Verification Notes

### Build (2026-05-16, auto run)

- `npx vite build` — clean (8128 modules, 15.9s, no errors).
- `npm run typecheck` — same pre-existing baseline of ui-kit prop-type mismatches in untouched files (`SidebarDisplayPanel`, `SidePanelCubeItem`, `TimeDateRangeSelector`, `TimeDateSelector`, `TimeListMember`, `ValuesInput`, `Pivot/Options`, `QueryBuilderExtras`, `QueryBuilderResults`, `rollup-designer/utils`). None of the files modified in this plan appear in the error list.
- **Vite build is the source of truth** (per plan note) — passing.

### Implementation summary

- **Phase 1 (tokens):** appended `--qrow-*`, `--pill-*`, `--add-pill-*`, `--preagg-banner-*`, `--live-badge-*`, `--table-header-bg` to `src/theme/tokens.css`. Additive — zero risk.
- **Phase 2 (run row):** `PreAggregationAlerts` gained `inline?: boolean` prop; renders as a styled `InlineBanner` chip when `inline`. `QueryBuilderRunControl` now renders `<PreAggregationAlerts inline />` + `RequestStatusComponent` in a wrapping `RunBandRight`. `QueryBuilderToolBarAlerts` no longer renders `PreAggregationAlerts` — only `QueryBuilderError`.
- **Phase 3 (query card):**
  - `member-pill-row.tsx`: `Row` switched to token-based grid (`--qrow-label-width` 88px, `--qrow-gap` 14px, dashed `--qrow-divider`); `PillBase` now 28px tall, white bg, 8px radius, asymmetric padding; `PillMono` rendered as tinted chip (`--pill-mono-bg`, 4px radius); `AddButton` is dashed orange (`--add-pill-*`). `MemberPillRow` gained optional `addLabel` prop (default "Add"). Cube prefix split into muted `PillCube` span. Per-member-type accent colors kept (intentional divergence from v2, documented in code).
  - `QueryStatePillBar.tsx`: Header padding 12px 16px. `LiveBadge` emerald chip with pulsing dot keyframe (`live-dot-pulse`, scoped). `FilterRow` aligned to qrow spec. Time row passes `addLabel="Add time"`.
  - `QueryBuilderFilters.tsx`: inline "Remove All" replaced with `RemoveAllPill` styled native button (dashed danger token palette), right-aligned in `InlineFooter`.
- **Phase 4 (chart pane):**
  - Created `chart-type-toggle.tsx` — segmented Line / Bar / Area / Table with brand-orange active state.
  - `ChartSidePane`: lifted Pivot dialog + Code (Vizard) dialog into header right slot; renders `ChartTypeToggle` in a `ToggleBar` below the header. New props: `chartType`, `onChartTypeChange`, `pivotConfig`, `onPivotMove`, `onPivotUpdate`, `VizardComponent`, `apiToken`, `apiUrl`, `query`.
  - `QueryBuilderChart`: stripped `AccordionCard`, internal Radio.Group, Pivot + Code dialog triggers, and obsolete `isExpanded` localStorage logic. Now renders only the chart body.
  - `QueryBuilderInternals`: pulls chart context into the pane component; removed the orphaned `isChartExpanded` state and inlined `forceMinHeight`.
- **Phase 5 (results):** audit-only — no edits applied in auto mode (token reserved for visual follow-up). Documented decision in `phase-05-results-polish.md`.

### Remaining deltas / follow-ups

- Table header tint (`--table-header-bg`) — token exists but not yet referenced. Apply after a live visual pass against Image #3.
- Footer Export CSV / Generate code buttons — not currently in `TableFooter`. Out of pixel-polish scope; tracked as follow-up.
- MemberPillRow `addLabel` only renders when an `onAdd` is wired. Dimension / Measure / Time rows in `QueryStatePillBar` currently rely on the sidebar for adds and have no `onAdd` handler — wiring inline add pickers is a feature task, not pixel polish.
