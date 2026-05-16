---
title: "Filter spacing + results compaction + resizable columns"
description: "Mid panel polish: roomier filter chips per Image #4, denser results table to surface more rows, drag-resizable column widths persisted to localStorage."
status: pending
priority: P2
branch: "main"
tags: [ui, refactor, results-table]
blockedBy: []
blocks: []
created: "2026-05-16T01:40:00.000Z"
createdBy: "ck:plan"
source: skill
---

# Filter spacing + results compaction + resizable columns

## Overview

Three coupled goals on the QueryBuilder mid panel:

1. **Filter row spacing** — per Image #4, give the filter chip breathing room inside its row while keeping vertical compactness. `+ Add` left, `× Remove all` right, clear divider between stacked filters.
2. **Results compaction** — shrink cell/header/footer padding so more rows fit on screen. Results panel is the primary data surface.
3. **Resizable column widths** — drag handles on column boundaries, widths persisted to localStorage, keyed by column name (survives reordering).

## References

- Image #4 — filter row target state (FILTERS label, chip, `+ Add` / `× Remove all` below)
- `plans/reports/researcher-v2-mid-panel-query-card.md` — `.qrow` / `.m-pill` / `.add-pill` spec (reused)
- v2 standalone HTML at `C:\Users\CPU12830-local\Downloads\Cube Playground v2 (standalone).html`
- Prior plan: `plans/260516-0102-mid-panel-v2-pixel-polish/` (foundation tokens already in `src/theme/tokens.css`)

## Phases

| Phase | Name | Status | Effort |
|-------|------|--------|--------|
| 1 | [Filter row spacing](./phase-01-filter-row-spacing.md) | Pending | 45m |
| 2 | [Results compaction](./phase-02-results-compaction.md) | Pending | 45m |
| 3 | [Resizable columns](./phase-03-resizable-columns.md) | Pending | 2h 30m |
| 4 | [Verification](./phase-04-verification.md) | Pending | 30m |

## Key Deltas vs Current State

| Area | Current | Target |
|------|---------|--------|
| Filter chip wrapper padding | `margin: -.5x; padding: .5x` (net zero) | `padding: 6px 8px` proper breathing room |
| Multi-filter separation | Flex column, gap 6px | Same gap + subtle dashed divider between chips |
| Filter footer alignment | `space-between` (correct) | Keep, verify vertical gap to chips above |
| Cell padding | `1x` (8px) | `.5x` (4px) vertical, `.75x` (6px) horizontal |
| Column header padding | `1x` | `.75x 1x` |
| Footer height | `5x` (40px) | `4x` (32px) |
| Row line-height | default (~1.5) | tighter (~1.3) via preset/explicit |
| Column widths | `repeat(N, auto)` CSS Grid | Custom widths[] state, drag handles, localStorage |

## Dependencies

None — token foundation already merged in prior plan.

## Risks

- **Resize handles & GridTable z-index**: `ColumnHeader` is sticky `top: 0; zIndex: 2`. Handles need `zIndex: 3` and absolute positioning relative to a header that owns its column. Existing `ReorderableMemberList` uses drag-to-reorder — resize must not interfere; restrict resize handle to the right ~6px strip of the header.
- **Reorder + resize coexistence**: When the user drags inside the header body, ReorderableMemberList captures it for reorder. Resize handles bind their own pointer events and call `stopPropagation` on pointerdown.
- **Width persistence key**: keyed by column name (`measure.foo`, `dimension.bar`) — survives reorder. New column → falls back to `auto`. Removed column → stale entry harmless, garbage-collect lazily on read.

## Unresolved Questions

None — proceed.
