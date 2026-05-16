---
phase: 2
title: "Results compaction"
status: pending
priority: P2
effort: "45m"
dependencies: []
---

# Phase 2: Results compaction

## Overview

Tighten cell/header/footer padding in the results table so more rows fit on screen without horizontal info loss. Pure styling — no logic / behavior changes.

## Requirements

- Cell padding: `1x` (8px) → `.5x` (4px) vertical, `.75x` (6px) horizontal.
- Cell minimum line-height tightened to ~18px (was inheriting `t3` default ~20px).
- Column header padding: `1x` → `.75x 1x` (6px vertical, 8px horizontal).
- Footer height: `5x` (40px) → `4x` (32px). Same content density.
- Cell `min 140px` minWidth: keep at 140px (Phase 3 owns user-resizable widths; minWidth is the floor).
- No change to fonts (`preset: 't3'` and `'t3m'` stay).
- No change to row contents, copy button placement, or selected cell shadow.

## Architecture

All changes inside `src/QueryBuilderV2/QueryBuilderResults.tsx` — `CELL_STYLES`, `GridTable.CellValue`, `ColumnHeader`, `TableFooter`. tasty DSL only.

## Related Code Files

- Modify: `src/QueryBuilderV2/QueryBuilderResults.tsx`
  - `CELL_STYLES` (line 324) — adjust padding, line height if needed
  - `GridTable.styles.CellValue.padding` (line 363) — `1x` → `.5x .75x`
  - `ColumnHeader.styles.padding` (line 405) — `1x` → `.75x 1x`
  - `TableFooter.styles.height` (line 100) — `5x` → `4x`

## Implementation Steps

1. **CellValue padding** — inside GridTable styles object, change `CellValue: { ..., padding: '1x' }` → `padding: '.5x .75x'`.

2. **Cell min line-height**: ensure rows feel tight. The cells already use `whiteSpace: 'nowrap'` so they're single-line. Default line-height comes from `preset: 't3'`. If still loose visually, add `lineHeight: '18px'` to the CELL_STYLES base object. Otherwise leave the preset alone (default is usually fine).

3. **ColumnHeader padding** — change `padding: '1x'` → `padding: '.75x 1x'`. Keeps horizontal touch target while shaving 4px vertical.

4. **TableFooter** — `height: '5x'` → `height: '4x'`. Verify pagination + result count line still vertically center (they use `placeContent: 'center space-between'`, so yes).

5. **Sanity check**:
   - Sticky column header still sticks (uses `position: 'sticky'; top: 0`).
   - Loading spinner alignment in footer unaffected.
   - No-results disclaimer (`DisclaimerContainer`, line 120) unchanged — it's not inside the table grid.

6. **typecheck + build**: `npm run typecheck` + `npx vite build`.

7. **Visual check**: load app, run a query, count visible rows before/after at the same window size. Expect ~25-33% more rows visible (rough back-of-envelope: 8px → 4px padding × 2 sides = 8px saved per row; default row ~32px → ~24px).

## Success Criteria

- [ ] Visible row count at the same window height increases noticeably (target ≥25% more rows)
- [ ] Headers still readable, no clipping of options button
- [ ] Footer still fits "100 results · received N minutes ago" + pagination on one line
- [ ] Sticky header still pins on scroll
- [ ] `npx vite build` clean

## Risk Assessment

- **Tight padding clips OptionsButton menu trigger**: OptionsButton is `.5x` margin already in CELL_STYLES. With reduced cell padding, the negative margin from OptionsButton may overlap text. Verify visually; if it clips, bump cell horizontal padding back to `1x` (still saves vertical).
- **Tag values (e.g., `{{NULL}}`) look squished**: They use `StyledTag` from ui-kit — tag padding is internal. Should be fine.
- **Member-active background colors at headers (`#measure-active` etc.)**: unchanged by padding tweak — only the chip footprint shrinks. Color blocks still readable.

## Next Steps

→ Phase 3 (resizable columns) builds on the same `QueryBuilderResults.tsx` — order Phase 2 before Phase 3 to avoid trivial conflicts, but they don't depend on each other functionally.
