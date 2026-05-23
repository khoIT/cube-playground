# Segment Detail Redesign — Stats Row + Collapsible Cards + Diverse Composition

**Date**: 2026-05-23 15:02–15:18
**Severity**: Medium
**Component**: Segments (detail view, presets, visuals, cards)
**Status**: Resolved
**Branch**: `new_design`

## What Shipped

Three coordinated changes on the segment-detail page to mirror Hermes' compact
information density.

1. **Stats row replaces KPI strip.** The 4-cell `.detailKpiStrip` grid (each
   cell a full `KpiTile` card with 24px value and uppercase label) collapses
   into a single inline `<HeadlineStatsRow>` — one rounded card, four cells
   separated by 1px dividers, 20px value, single-line layout. Saves ~60–80 px
   of vertical space above the tab strip. Preset path (`headlineKpis`) and
   fallback path (Size / Last refresh / Owner / Status) both route through the
   new component; orphaned `SizeKpiTile` deleted.

2. **All chart cards collapsible.** `CardShell` and the three Monitor sections
   (size trend, refresh history, activations) gained a chevron toggle in their
   header. State persists per-card in `localStorage` under
   `gds-cube:card-collapsed:{cardKey}`. The shared `useCollapsiblePref` hook
   centralises the read/write. When collapsed, the card body is removed from
   the DOM so heavy charts (Recharts pie / bar / area) don't keep recomputing
   off-screen.

3. **Diverse composition in Insights overview.** Added a new `segmented-bar`
   card kind — a single stacked horizontal bar with inline % labels per
   segment and a colour-coded legend below — paired with a new
   `<SegmentedBar>` visual primitive in `src/pages/Segments/visuals/`. The
   `mf_users-hub` Overview now renders Lifecycle stage and Spend tier as
   segmented bars, Top countries as a bar list, and Device platform as a
   donut, matching the screenshot reference. The auto-preset synthesiser
   mirrors this rotation (`segmented-bar`, `segmented-bar`, `bar`, `donut`)
   across the first four categorical dims of any cube, so cubes without a
   curated preset still get a Hermes-style overview.

## Files Touched

- `src/pages/Segments/detail/detail-view.tsx` — drop `detailKpiStrip`, drop
  `KpiTile` + `SizeKpiTile` fallback, drop `formatCount`, render
  `<HeadlineStatsRow>`.
- `src/pages/Segments/detail/components/stats-row.tsx` (new) — pure presentational
  row + `useStatItemFromKpi` data hook.
- `src/pages/Segments/detail/components/stats-row.module.css` (new) — local
  styles, sits flush with detail header.
- `src/pages/Segments/detail/components/headline-stats-row.tsx` (new) —
  resolves preset KPI specs or fallback cells into a single row.
- `src/pages/Segments/detail/components/size-kpi-tile.tsx` — deleted (orphan).
- `src/pages/Segments/detail/cards/card-shell.tsx` — chevron, `cardKey`,
  `trailing` slot.
- `src/pages/Segments/detail/cards/use-collapsible-pref.ts` (new) — shared
  localStorage-backed hook.
- `src/pages/Segments/detail/cards/{line-chart,bar-list,donut,composition-card-component}.tsx`
  — pass `cardKey={cacheKey}` so each card gets a stable collapse identity.
- `src/pages/Segments/detail/cards/segmented-bar-card.tsx` (new) — data-bound
  wrapper for the new segmented bar primitive.
- `src/pages/Segments/detail/tabs/monitor/{size-trend,refresh-history,activation-summary}-section.tsx`
  — chevron toggles via `useCollapsiblePref`.
- `src/pages/Segments/detail/tabs/preset-tab.tsx` — switch case for
  `segmented-bar`.
- `src/pages/Segments/presets/types.ts` — `SegmentedBarCardSpec` added to
  `CardSpec` union.
- `src/pages/Segments/presets/mf-users-hub.ts` — overview tab rewired to
  segmented-bar + bar + donut + line mix.
- `src/pages/Segments/presets/auto-preset.ts` — rotation over the first four
  categorical dims (`segmented-bar`, `segmented-bar`, `bar`, `donut`).
- `src/pages/Segments/visuals/segmented-bar.tsx` (new) + visuals.module.css
  styles + index barrel export.
- `src/pages/Segments/segments.module.css` — drop `.detailKpiStrip`, drop
  `.sizeKpiWrap/Sparkline/Overlay`, add `.cardCollapseBtn`.
- `src/pages/Segments/presets/__tests__/auto-preset.test.ts` — assertions
  updated for the diverse-chart overview.

## Test Posture

- `npx vitest run`: **696/696 pass** (no new tests; existing auto-preset spec
  rewritten to match the new chart-kind rotation).
- `npx tsc --noEmit`: my changes typecheck clean. Pre-existing TS errors in
  `Catalog/cdp-projection`, `Settings`, `Schema`, `push-modal`, and `dev/`
  are unrelated and untouched.

## Design Decisions

- **Storage key under `gds-cube:card-collapsed:`** matches the existing
  `gds-cube:*` localStorage namespace used elsewhere in the shell, so a
  future "Reset preferences" flow can wipe everything via prefix.
- **`cardKey = cacheKey`** for preset cards. The cacheKey is already stable
  per `(tab.id, card.id)` so it doubles cleanly as the collapse identity
  without inventing a parallel id scheme.
- **`segmented-bar` not a variant of `composition`.** Composition combines a
  donut and a bar list in one card — overkill for the lifecycle / spend
  tier strip in the screenshot. Spec-level distinction keeps the renderer
  branchless.
- **Auto-preset rotation prefers segmented-bar for first two dims** because
  the first categorical dim in a cube is almost always the lifecycle /
  status / tier dim — exactly the shape that reads best as a stacked strip.

## Next Steps

- Curated presets for `recharge` and other cubes could adopt the new
  rotation, but only `mf_users-hub` is updated for now.
- The `SizeTrend` section sparkline that previously lived inside the KPI
  card is gone in the preset path (preset's `Size` KPI fetches its measure
  from Cube and doesn't have a refresh-log series). Fallback path keeps the
  sparkline. If we want the sparkline back on preset segments, the
  `headline-stats-row` `footer` slot is the place to add it.
- Collapse state is per-segment (id appears in `cardKey` for monitor
  sections). Preset cards use `cacheKey` which doesn't include segment id;
  that's intentional so the user's collapsed Insights overview stays
  collapsed when navigating between segments of the same shape. Revisit if
  per-segment behaviour is preferred.
