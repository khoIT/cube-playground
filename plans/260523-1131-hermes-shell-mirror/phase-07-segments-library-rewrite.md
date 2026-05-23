---
phase: 7
title: "Segments Library Rewrite"
status: pending
priority: P1
effort: "2-3 hr"
dependencies: [6]
---

# Phase 7: Segments Library Rewrite

## Context Links

- Brainstorm § 4.3 (file layout) + § 5 Phase 6
- Spec: [`phase-00-spec/port-manifest.md`](./phase-00-spec/port-manifest.md) § "Segments library"
- Hermes reference: `apps/web/src/modules/segments/library.tsx`
- Cube current: `src/pages/Segments/library/library-view.tsx`

## Overview

Rewrite cube's segment library to Hermes goal-grouped row pattern: left filter rail + main column with stat strip + goal-grouped rows (serif name + mono id + goal badge + author chip + count + sparkline + avatar + actions). Preserve cube-specific hooks: `useLibraryUrlState`, `BulkActionsToolbar`, `ImportIdsModal`, `useRefreshLogs`. **Skip features not in cube** (4R goals — adapt to cube tags or skip grouping).

## Key Insights

- Cube `Segment` shape has: `id, name, owner, definition (cube query JSON), audience_size?, status, created_at, updated_at, tags?`. No `goal: '4r'`. **Adapt grouping** to use `tag[0]` or fall back to "Ungrouped".
- Hermes `MiniAvatar` generates color from initials hash — port verbatim.
- Hermes filter chips (`FilterDropdownChip`) live in `feature-store/_components/`; copy to cube's `shell/components/` if needed, or inline simpler version (cube already has filter pills).
- Cube has `library-filter-pills.tsx`, `library-toolbar.tsx`, `bulk-actions-toolbar.tsx`, `import-ids-modal.tsx`, `library-meta-line.tsx` — restyle these instead of rewriting (preserve their behavior).
- Push to recent-items on segment click via Phase 6 hook → already handled.
- "Goal" badge color map from Hermes — adapt to cube tag colors if no `goal` field; use neutral if no tag.
- Cube uses `useTopbarTrailing` (Phase 4) to put "+ New segment" button in topbar (Hermes pattern).

## Requirements

### Functional
- Library page renders at `/segments`.
- Left rail filters: GROUP BY (tag/owner/status/none), STATUS, HAS OPEN CAMPAIGNS (skip if cube has no campaign linkage — use "Has refresh schedule" instead).
- Main column: title block + meta line + filter pills + segment rows.
- Rows grouped by selected GROUP BY field.
- Each row: name (serif italic via `T.fDisp`/Inter italic), id (`T.fMono`), badge (tag color), owner chip + avatar, audience count, sparkline, action icons (view/edit).
- URL state persists (filter, sort, search, group-by).
- Multi-select with bulk-actions toolbar preserved.
- Click row → navigate to `/segments/:id` (Phase 8 detail still works).
- Click "+ New" in topbar trailing → open editor (`/segments/new`).

### Non-functional
- `library-view.tsx` ≤ 250 lines (composition only).
- New row component ≤ 200 lines.
- New filter rail component ≤ 150 lines.

## Architecture

```
src/pages/Segments/library/
  library-view.tsx                ◆ REWRITE (composition)
  library-filter-rail.tsx          ★ NEW (left rail)
  library-segment-row.tsx          ◆ REWRITE (Hermes goal-row style)
  library-meta-line.tsx            ◆ RESTYLE (T tokens, no functional change)
  library-toolbar.tsx              ◆ RESTYLE (search input + sort dropdown using T)
  library-filter-pills.tsx         ◆ RESTYLE (filter chips using T)
  bulk-actions-toolbar.tsx         ◆ RESTYLE (sticky bar w/ T tokens)
  library-filter-sort.ts           ✓ UNCHANGED (pure logic)
  use-library-url-state.ts         ✓ UNCHANGED
  use-refresh-logs.ts              ✓ UNCHANGED
  cells/                            ✓ UNCHANGED (cells likely reused by row)
  row-actions-menu.tsx             ✓ UNCHANGED (dropdown — Antd kept)
  import-ids-modal.tsx             ✓ UNCHANGED
```

### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  Topbar trailing: [+ New segment]   [Import IDs]   [Refresh]            │
├────────────────────────────────────────────────────────────────────────┤
│  Page content:                                                           │
│  ┌───────────┐  ┌─────────────────────────────────────────────────────┐ │
│  │ FILTER    │  │ Title (Library — T.fDisp 40px)                       │ │
│  │ RAIL      │  │ Meta line (X segments · last refreshed Y)            │ │
│  │ — GROUP BY│  │ Filter pills (status: active, retain, ...)           │ │
│  │ — TAG/4R  │  │ ─────────────────────────────────────────────────── │ │
│  │ — STATUS  │  │ GROUP HEADER: Retain (3)                             │ │
│  │ — HAS …   │  │ ┌─ Row 1: name | id | badge | owner | sparkline ──┐ │ │
│  │           │  │ ┌─ Row 2 ─────────────────────────────────────────┐ │ │
│  │ 200px wide│  │ ...                                                │ │ │
│  └───────────┘  └─────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### Hermes row style (per pixel-spec — adapted from `library.tsx`)

| Element | Style |
|---|---|
| Row container | padding `12px 16px`, border-bottom `1px solid #eeece6` (HAIRLINE) |
| Name | serif italic, `15px`, weight `500`, color `T.n950` |
| Id (mono) | `T.fMono`, `11px`, color `T.n500` |
| Goal/Tag badge | per GOAL_MAP color, padding `2px 8px`, radius `4` |
| Owner chip | `MiniAvatar` (22px) + name (`12px`, `T.n700`) |
| Count | `T.fDisp`, `18px`, `T.n950` |
| Sparkline | 80×24, brand color, 12% fill |
| Action icons | Eye + Pencil, 14px, T.n500, hover T.n900 |

## Related Code Files

### Create
- `src/pages/Segments/library/library-filter-rail.tsx`

### Rewrite
- `src/pages/Segments/library/library-view.tsx`
- `src/pages/Segments/library/library-segment-row.tsx`

### Restyle (T tokens, keep behavior)
- `src/pages/Segments/library/library-meta-line.tsx`
- `src/pages/Segments/library/library-toolbar.tsx`
- `src/pages/Segments/library/library-filter-pills.tsx`
- `src/pages/Segments/library/bulk-actions-toolbar.tsx`

### Modify (move actions from inline to topbar trailing)
- `src/pages/Segments/library/library-view.tsx` — call `useTopbarTrailing` to push "+ New" + "Import IDs" + "Refresh" buttons.

### Delete
- None (keep cells/, row-actions-menu.tsx, import-ids-modal.tsx)

## Implementation Steps

1. **Read cube `Segment` type** from `src/types/segment-api.ts`. Confirm fields: `id, name, owner, audience_size, status, tags, created_at, updated_at`.

2. **Build `library-filter-rail.tsx`**:
   - Sticky left column, width 200, padding 16, border-right `1px solid T.n200`.
   - Sections: GROUP BY (radio: tag / owner / status / none), STATUS (multi-checkbox: active / draft / stale), HAS REFRESH (yes/no/any).
   - Subheader style per `pixel-spec.md` (mono uppercase).
   - Wires to `useLibraryUrlState` (extend its setter signature if needed — add `groupBy`).

3. **Rewrite `library-segment-row.tsx`**:
   - Port Hermes' `library.tsx` row JSX block (~lines 150-300 in Hermes source).
   - Replace `goal` field with `tags[0]` (or `'ungrouped'`).
   - Replace `GOAL_MAP` with `TAG_COLOR_MAP` (cube-specific or use neutral fallback).
   - Replace `MiniAvatar` with same impl (port verbatim).
   - Sparkline data: pull from `useRefreshLogs(segmentId).history` (cube hook returns count over time).
   - Action buttons: View (Eye → `/segments/:id`), Edit (Pencil → `/segments/:id/edit`).

4. **Rewrite `library-view.tsx`**:
   - Composition only — no inline styles beyond layout.
   - Topbar trailing registration:
     ```tsx
     const { setNode } = useTopbarTrailing();
     useEffect(() => {
       setNode(<>
         <Button leftIcon={Plus} onClick={() => history.push('/segments/new')}>New segment</Button>
         <Button variant="outline" leftIcon={Upload} onClick={() => setImportOpen(true)}>Import IDs</Button>
       </>);
       return () => setNode(null);
     }, []);
     ```
   - Page body: `<FilterRail/>` (left) + main column (right).
   - Main column: title ("Library"), meta line, filter pills, grouped rows.
   - Group rendering: for each unique value of `groupBy` field → header row + rows.

5. **Restyle existing files** — replace `--brand` / `--text-primary` / `var(--bg-card)` with `T.brand` / `T.n900` / `T.surface`. Replace AntD `<Input>` with cube's existing input OR inline Hermes-style. Replace styled-components blocks where simpler.

6. **Drop unavailable features per request** ("skip on functions that is not available"):
   - If cube `Segment` has no `goal` field — group by `tags[0]` instead, with a "GROUP BY: Tag / Owner / Status" radio.
   - If cube has no campaign linkage — skip "HAS OPEN CAMPAIGNS" filter; replace with "Has refresh schedule".
   - If cube has no `owner.avatar_url` — use `MiniAvatar` initials only.

7. **`npm run typecheck`** must pass.

8. **`npm run test`** — library specs must pass; update snapshots that capture HTML.

## Todo List

- [ ] Inspect cube Segment shape; confirm available fields
- [ ] Build `library-filter-rail.tsx`
- [ ] Extend `useLibraryUrlState` with `groupBy` URL param
- [ ] Rewrite `library-segment-row.tsx` with Hermes row style
- [ ] Port `MiniAvatar` to a small helper inside cells/ or shell/components/
- [ ] Rewrite `library-view.tsx` with filter-rail + grouped rows
- [ ] Register library actions in topbar trailing slot
- [ ] Restyle `library-meta-line.tsx`, `library-toolbar.tsx`, `library-filter-pills.tsx`, `bulk-actions-toolbar.tsx`
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (update snapshots intentionally)

## Success Criteria

- [ ] Library page visually matches Hermes library at 1440×900.
- [ ] Group-by tag works; rows segmented under group headers.
- [ ] URL state survives reload (filter, sort, group, query).
- [ ] Multi-select + bulk actions still work.
- [ ] Click row → navigates to `/segments/:id` (Phase 8 detail).
- [ ] "+ New segment" in topbar trailing → navigates to `/segments/new`.
- [ ] Import IDs modal still works.
- [ ] No console errors; existing tests pass.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Cube Segment shape mismatches Hermes assumptions (no `goal`, no sparkline data) | Adapt rendering per step 6; document each skip in code comment |
| Restyle loses URL-state behavior | `useLibraryUrlState` hook preserved verbatim; only render layer changes |
| Bulk-actions toolbar layout breaks at narrower viewport | Sticky `position: top` keeps it inside scroll; existing behavior |
| Sparkline blank if `useRefreshLogs` returns empty | Render placeholder `—` instead |
| Topbar trailing buttons collide with GamePicker | TopbarTrailing context replaces previous node; only library actions show on /segments |

## Security Considerations

- No new data fetched. `segmentsClient` and `useRefreshLogs` unchanged.
- Bulk actions (delete, refresh) still gated by cube's existing permission checks.

## Next Steps

Phase 8 restyles the segment detail page (Monitor / Insights / Members / Definition / Activation tabs).
