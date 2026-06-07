# Phase 3 — Compact number formatting (B tier) + responsive KPI strip

## Context Links
- Formatter: `src/pages/Segments/detail/cards/format-value.ts` (`currency` branch renders FULL `₫10,286,465,000` — overflow bug; `compact` caps at M, no B)
- `formatCount` cap at M: `src/pages/Segments/detail/components/headline-stats-row.tsx:57-61`
- KPI cell render: `src/pages/Segments/detail/components/stats-row.tsx:41-66` (`StatCellInner`, `.valueRow` flex-wrap, `.value`)
- CSS: `src/pages/Segments/detail/components/stats-row.module.css` (`.statsRow` flex gap:0, `.statCell` flex:1 1 0, `.value`)
- User decision 2: compact display + FULL exact value in hover tooltip (`title` attr) on ALL KPI cells.

## Overview
- Priority: P2. Status: pending. Independent (own files).
- Add a billion tier + a shared compact helper; surface exact value via `title` tooltip; make KPI strip wrap responsively.

## Requirements
- Compact tiers: `>=1e9 → "10.29B"`, `>=1e6 → "10.3M"`, `>=1e3 → "7.6k"`, else integer. Currency prefixes `₫` (VND). Decimals: B/M → 2 sig as `10.29B`/`10.3M` (match pinned examples: ₫10.29B, 7.6k, 10.3M).
- DRY: ONE compact core used by both `format-value.ts` currency/compact branches AND `formatCount`. `formatCount` should delegate (remove its own M cap).
- `currency` branch: switch from full `toLocaleString` to compact-with-₫ for display; exact full value still available for tooltip.
- Exact-value tooltip: `StatCellInner` `.value` span gets `title={exactFormatted}` (full `n.toLocaleString()` / full currency). Plumb an optional `exactValue`/`title` prop through the KPI item shape; fall back to display value if absent.
- Responsive: `.statsRow` wraps to 2×2 below a container width; consistent gap from the scale (e.g. 12/16). Keep `flex:1 1 0` cells; add `flex-wrap` + `min-width` so cells reflow instead of overflowing.

## Related Code Files
- Modify: `src/pages/Segments/detail/cards/format-value.ts` (add B tier + shared `formatCompact` core; currency uses compact for display + export an exact formatter)
- Modify: `src/pages/Segments/detail/components/headline-stats-row.tsx` (`formatCount` delegates; pass exact value into KPI item)
- Modify: `src/pages/Segments/detail/components/stats-row.tsx` (`StatCellInner` add `title`/exact on `.value`)
- Modify: `src/pages/Segments/detail/components/stats-row.module.css` (`.statsRow` flex-wrap + responsive 2×2, `.statCell` min-width)

## Implementation Steps
1. In `format-value.ts`: add `formatCompact(n, { currency?: boolean })` core with B/M/k tiers; add `formatExact(value, format)` returning full string for tooltip. Route `compact` + `currency` branches through `formatCompact`.
2. In `headline-stats-row.tsx`: replace `formatCount` body with delegation to `formatCompact`; attach exact value to each KPI item (full count / full currency).
3. In `stats-row.tsx`: extend item/props with optional exact string; render `title={exact ?? value}` on `.value` span.
4. CSS: `.statsRow { flex-wrap: wrap; gap: 16px }`; `.statCell { min-width: 160px }`; below container width cells form 2×2. Keep token usage.
5. `npx tsc --noEmit`.

## Todo List
- [ ] formatCompact + formatExact in format-value.ts (B tier)
- [ ] currency branch uses compact for display
- [ ] formatCount delegates (M cap removed)
- [ ] exact value plumbed to StatCellInner title
- [ ] responsive 2×2 KPI strip CSS
- [ ] tsc passes

## Success Criteria
- ₫10,286,465,000 renders `₫10.29B`; 7600 → `7.6k`; 10,300,000 → `10.3M`.
- Hover any KPI value shows exact full number in native tooltip.
- KPI strip reflows to 2×2 on narrow widths, no horizontal overflow. Tokens only.

## Risk Assessment
- R: B-tier rounding hides material differences (Low/Med) → exact tooltip mitigates; 2-decimal B keeps precision.
- R: existing snapshot/format tests assert old M-cap output (Med/Low) → update in P6; grep `format-value` + `formatCount` tests.
- R: `title` attr clashes if value already a ReactNode (the uid_count JSX branch at headline-stats-row.tsx:88-95) (Med) → ensure exact passed as string, wrap span carries title.

## Rollback
- Revert the 4 files; pure-function change, no persisted data.

## Next Steps
- P6 adds unit tests for `formatCompact`/`formatExact`.
