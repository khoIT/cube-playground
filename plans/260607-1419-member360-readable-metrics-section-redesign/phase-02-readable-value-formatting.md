# Phase 2 — Readable value formatting (compact ₫, relative dates, exact tooltips)

## Context Links
- Formatter: `src/pages/Segments/member360/format-cell.ts` (`currency` branch → FULL `₫10,286,465,000`; ISO dates pass through raw)
- Consumers: `sections/dashboard-hero.tsx:118` (pills), `sections/dashboard-stats.tsx:54-62` (`display()` → tiles + KV), `member-panel.tsx` (details tabs use formatCell via format-cell import — verify)
- Shared core (sibling plan): `src/pages/Segments/detail/cards/format-value.ts` — plan `260607-1331` P3 adds `formatCompact`/`formatExact` there
- Existing compact tier in formatCell caps at M (`format-cell.ts:42-45`), no B tier

## Overview
- Priority: P2. Status: pending. Independent of P1 (pure functions).
- Make every profile-row value human readable: compact currency with B tier, relative
  date context, exact full value via `title` tooltip.

## Requirements
- **Currency**: display `₫10.29B` / `₫45.2M` / `₫7.6k` (tiers >=1e9/1e6/1e3, 2 sig on B,
  1 dec on M/k); exact `₫10,286,465,000` available for tooltip.
- **DRY**: reuse `formatCompact`/`formatExact` from `detail/cards/format-value.ts` if
  1331-P3 landed; otherwise CREATE the core there (same names/signatures) so 1331-P3
  delegates later. ONE compact core in the codebase.
- **Dates**: ISO date → `7 Jun 2026` short form; add relative suffix for *recency-meaning*
  fields (`last_active_date`, `last_login_date`, `last_recharge_date`): `7 Jun 2026 (2d ago)`.
  Relative tier: today / Nd ago / Nmo ago / Ny ago. Driven by a new opt-in
  `format: 'date-relative'` FormatId on the field config — NOT a field-name heuristic.
- **Day counts**: `days_since_install` 412 → `412d (~1.1y)` via opt-in `format: 'tenure'`.
- **Tooltips**: new `formatCellExact(value, format): string | null` — returns exact form
  when display is lossy (compact/currency/relative), null when display already exact.
  `display()` in dashboard-stats + hero pill render attach `title` when non-null.
- formatCell stays never-throw, string-out; unknown shapes fall back to `String(value)`.

## Related Code Files
- Modify: `src/pages/Segments/member360/format-cell.ts` (delegate currency/compact to shared core; add date-relative + tenure branches + `formatCellExact`)
- Modify (only if 1331-P3 not landed): `src/pages/Segments/detail/cards/format-value.ts` (add shared `formatCompact`/`formatExact` core)
- Modify: `src/pages/Segments/presets/types.ts` (`FormatId` union += `'date-relative' | 'tenure'`)
- Modify: `src/pages/Segments/member360/member360-sections.ts` (stamp new formats on last_active/last_login/last_recharge/days_since_* fields)
- Modify: `src/pages/Segments/member360/sections/dashboard-stats.tsx` + `dashboard-hero.tsx` (title attr plumbing — keep < 200 LOC)
- Create: `src/pages/Segments/member360/__tests__/format-cell.test.ts`

## Implementation Steps
1. Check whether 1331-P3 landed (`grep formatCompact src/pages/Segments/detail/cards/format-value.ts`); create or import the core accordingly.
2. Rewrite `format-cell.ts` branches: currency/compact → core; add `date-relative`, `tenure`; export `formatCellExact`.
3. Extend `FormatId`; stamp formats in `member360-sections.ts` (pills + sections).
4. Plumb `title={exact}` in `display()` callers (StatTileGrid, KvList, hero pills).
5. `npx tsc --noEmit` + unit tests.

## Todo List
- [x] Shared compact core (reuse or create)
- [x] format-cell: compact ₫ + B tier
- [x] date-relative + tenure formats
- [x] formatCellExact + title plumbing (tiles, KV, pills)
- [x] FormatId union + section config stamps
- [x] Unit tests + tsc green
- [x] Chart datetime axis labels (addendum below)

## Addendum — chart datetime axis labels (folded in from 1331 follow-up)
1331 landed `makeTimeTickFormatter`/`formatChartDateTooltip` in
`src/utils/format-chart-datetime-label.ts` (regex ISO parse, no `new Date()` TZ
day-shift; tests in `src/utils/__tests__/`). Two surfaces still render raw ISO
x labels — wire the same formatter:
- `src/pages/Segments/member360/mini-bar-chart.tsx` — x tick + tooltip label
- `src/pages/Catalog/.../metric-sparkline.tsx` — x tick + tooltip label (locate via grep; Catalog scope rides along here because it's the same one-line wiring)
- [x] mini-bar-chart x labels human-readable
- [x] metric-sparkline x labels human-readable

## Success Criteria
- Hero LTV pill shows `₫10.29B`, hover shows `₫10,286,465,000`.
- Last active shows `5 Jun 2026 (2d ago)`; days_since_install shows `412d (~1.1y)`.
- Existing date/duration/Yes-No behavior unchanged elsewhere (details tabs, event panels).
- "Now" derived once per render via injectable param (`now: Date = new Date()`) for testability.

## Risk Assessment
- R: details-tab panels share formatCell — new branches are opt-in via FormatId, so
  existing panels (no new format ids) render identically (Low).
- R: 1331-P3 lands mid-flight with different signature (Med) → coordinate: whoever lands
  second rebases on the first's core; signatures pinned above.
- R: timezone drift on relative dates (Med) → compute against local midnight, test with
  fixed `now`; warehouse dates are date-only strings (GMT+7 business dates).

## Rollback
- Revert files; pure display change, no persisted data, cache keys untouched.

## Next Steps
- P3 consumes the new formatters in the redesigned sections.
