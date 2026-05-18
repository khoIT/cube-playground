---
phase: 4
title: "Verification"
status: pending
priority: P2
effort: "30m"
dependencies: [1, 2, 3]
---

# Phase 4: Verification

## Overview

Type-check, vite build, dev-server visual diff against Image #4 + functional resize/reorder/persist test.

## Implementation Steps

1. **Type check**: `npm run typecheck`. Expect same pre-existing ui-kit baseline as prior plan; the files we modified must NOT appear in the error list.
2. **Build**: `npx vite build` — must complete cleanly.
3. **Dev server**: `npm run dev`. Open QueryBuilder.
4. **Filter row diff (vs Image #4)**:
   - [ ] FILTERS label uppercase, muted, left column 88px
   - [ ] Filter chip has visible breathing room inside the white card
   - [ ] When 2+ filters, dashed divider between them
   - [ ] 12px gap below the chip(s) before the `+ Add` / `× Remove all` row
   - [ ] `+ Add` left, `× Remove all` right (red dashed)
5. **Results compaction**:
   - [ ] More rows visible at the same window height than before (count before/after)
   - [ ] Footer 32px tall, still readable
   - [ ] Sticky header still sticks on scroll
6. **Resizable columns**:
   - [ ] Hover near right edge of a header → cursor `col-resize`
   - [ ] Drag widens / narrows the column live
   - [ ] Clamp at 80px floor and 800px ceiling
   - [ ] Refresh page → widths persist
   - [ ] Reorder a column via header drag → widths re-attach correctly
   - [ ] ESC mid-drag → width restores
7. **Regression sweep**:
   - [ ] Existing reorder via header drag still works
   - [ ] OptionsButton menu still opens (top-right of each header)
   - [ ] Copy button on selected cell still appears
   - [ ] Pagination still works at >100 rows
8. **Document remaining deltas** as a `## Verification Notes` section appended below.

## Success Criteria

- [ ] `npx vite build` clean
- [ ] All checklist items pass OR remaining items documented + accepted

## Risk Assessment

- **Pre-existing tsc errors in ui-kit types** — known. `npx vite build` is the source of truth.
- **Browser caching** — hard-reload (Ctrl+Shift+R) if styles look stale.

## Verification Notes (2026-05-16 auto run)

### Build / Typecheck
- `npx vite build` — **clean** (8131 modules, 19.8s, no errors). Same baseline before/after.
- `npx tsc --noEmit` — only pre-existing ui-kit prop-type baseline (FilterMember.tsx:88 Select, FilterMember.tsx:200 Switch, QueryBuilderResults.tsx:174 replaceAll, :206 Select, :281 Menu). None of my edits introduced errors. Confirmed by line-range diff against modified regions (~lines 340-440 CELL_STYLES/header/footer + ~720 new state hooks + handle injection sites).

### Implementation summary
- **Phase 1 (filter spacing):**
  - `DateRangeFilter.tsx`, `FilterMember.tsx`, `SegmentFilter.tsx`: dropped `margin: -.5x` cancellation, set `padding: '.75x 1x'` (6px vertical, 8px horizontal). Chips now have visible breathing room inside their white-card wrappers.
  - `QueryBuilderFilters.tsx`: `InlineWrapper` gap 8px → 12px; new `InlineChipsContainer` styled-div applies `border-top: 1px dashed var(--neutral-100); margin-top: 8px; padding-top: 8px` to every chip after the first. Chip mapping extracted into `chipsContent` fragment to support both inline (with dividers) and non-inline (in Flex card) rendering paths without duplication.
- **Phase 2 (results compaction):**
  - `QueryBuilderResults.tsx`: `CellValue` padding `1x` → `.5x .75x` (4px / 6px); `ColumnHeader` padding `1x` → `.75x 1x` (6px / 8px); `TableFooter` height `5x` → `4x` (40px → 32px), padding `1x` → `.75x 1x`.
- **Phase 3 (resizable columns):**
  - New `src/QueryBuilderV2/hooks/use-column-widths.ts` — `useColumnWidths(storageKey)` returns `{ widths, setWidth, getColumnTemplate }`. Backed by `useLocalStorage`. Widths clamped to `[80, 800]` px.
  - New `src/QueryBuilderV2/components/column-resize-handle.tsx` — `ColumnResizeHandle` absolutely positioned 6px-wide strip on right edge of `ColumnHeader`. PointerDown stops propagation (so reorder-drag isn't triggered on the handle). Live `pointermove` calls `onResize`; `pointerup` commits via `onCommit`; `Escape` cancels via `onCancel`. Cursor lock `col-resize` on body during drag.
  - `QueryBuilderResults.tsx`: introduced `useColumnWidths('QueryBuilder:Results:columnWidths')` + `livePreviewWidths` state. Built `orderedColumnNames = [...dimensions, ...timeDimensions(name), ...measures]` and computed `gridColumnsTemplate` via `getColumnTemplate(names, livePreview)`. Replaced `columns={\`repeat(N, auto)\`}` with `columns={gridColumnsTemplate}`. Injected `<ColumnResizeHandle>` after `<OptionsButton>` inside each of dimension / time / measure header builders. Each ColumnHeader carries `data-resize-anchor={columnName}` so `measureHeaderWidth` can locate it via `tableRef.current?.querySelector` at drag start.

### Manual QA (pending — requires dev server)
The following requires `npm run dev` + browser interaction and was not auto-run:
- Filter row vs Image #4 visual diff
- More-rows-visible count (Phase 2)
- Drag a column → widen / narrow live (Phase 3)
- Refresh → widths persist (Phase 3)
- Reorder a column → widths re-attach by name (Phase 3)
- ESC mid-drag → restore (Phase 3)
- Existing reorder-via-header-drag still works (regression check)

### Remaining deltas / follow-ups
- Auto-fit-to-content double-click on resize handle — not implemented (out of scope).
- Visual QA still owed by user in dev server (see Manual QA above).
