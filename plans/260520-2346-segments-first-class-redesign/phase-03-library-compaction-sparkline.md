---
phase: 3
title: "Library compaction + sparkline"
status: completed
priority: P1
effort: "2d"
dependencies: [1, 2]
brainstormId: P1
---

# Phase 3 (P1): Library compaction + sparkline

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §5
- Mockup: `../visuals/segments-first-class-mockup.html` — Library screen
- Existing Library: `src/pages/Segments/library/{library-view,library-kpi-tiles,library-toolbar,library-segment-row,library-filter-sort}.tsx`

## Overview

Drop the 4 KPI tiles. Compact header (title + meta line). Add Broken to filter pills with counts. Add Health column (consolidating Type + Status into a colored-dot + label stack). Add **Used in** destination chips column (reads `segment.activations[]` from Phase 4). Add Trend column with 7-day sparkline (renders from new `segment_refresh_log` table). Sentence-case sweep across i18n.

## Key Insights

- Saves ~200 px above-the-fold (KPI strip = ~140 px + extra padding).
- Filter pill `Broken` is a hard sell only if at least one broken segment exists — but it's also a habit-builder: liveops gets used to scanning for broken cohorts before downstream tools surface failures.
- Destination chips column is **empty by default** until Phase 4 lands the data model + Phase 7 wires real activations. Render `—` cell for empty for now; Phase 4 will fill chips when data exists.
- Sparkline data: new table `segment_refresh_log` written by `refresh-segment.ts` cron job. Will show `—` for ~7 days post-deploy until enough history accumulates.
- `LibraryKpiTiles` component becomes unused — delete the file, remove import.
- Row grid: `minmax(280px, 2.4fr) 130px 90px 110px 200px 120px 36px` (was: `minmax(280px, 2.4fr) 110px 160px 110px 110px 140px 36px`). Reorder + Health/Trend/Used-in/Owner.

## Requirements

**Functional**
- Title row: `<h1>Segments</h1>` + meta line `{N} segments · {totalUidsFormatted} users · last refresh {ago}`. Right side: Import + `+ New segment` (orange pill).
- Filter pills: `All N` / `Live N` / `Static N` / `Broken N` with counts derived from current segment list.
- Search input has `⌘K` shortcut hint (placeholder, no global handler in this phase).
- Sort select kept (`Recent` / `Name` / `Size`).
- Identity-settings icon-button (Lucide `settings-2`) links to `/segments/identity-map`.
- Table columns: Segment/cube · Health · Size · Trend · Used in · Owner · chevron.
- **Health** cell: colored dot (success/warning/destructive/muted) + 2-line stack (label + secondary). Stale = warning, Broken = destructive (with reason as secondary), Live = success (with cadence as secondary), Static = muted.
- **Trend** cell: inline 80×28 SVG sparkline from last 7 refresh-log rows; render `—` if log empty or static.
- **Used in** cell: chips from `segment.activations[]` (max 2 shown, overflow `+N`). Phase 4 ships the data model; this phase renders empty-state.
- Migration `005-refresh-log.sql` creates `segment_refresh_log(id, segment_id, ts, uid_count, status)` table + index on `(segment_id, ts DESC)`.
- `refresh-segment.ts` writes one row per successful refresh.
- New `segments-client.refreshLog(id, days)` fetches sparkline data (server endpoint `GET /segments/:id/refresh-log?days=7`).
- Library bulk-fetches refresh logs for visible segments in one call to avoid N+1.

**Non-functional**
- Above-the-fold ≤ 160 px (title row + meta + filter row).
- New library files ≤ 200 LOC each. Modularize: `library-meta-line.tsx`, `library-filter-pills.tsx`, `cells/health-cell.tsx`, `cells/trend-cell.tsx`, `cells/destinations-cell.tsx`.

## Architecture

```
src/pages/Segments/library/
  ├─ library-view.tsx           — orchestrator, fetches segments + bulk refresh logs
  ├─ library-meta-line.tsx      NEW (~50 LOC)
  ├─ library-filter-pills.tsx   NEW (~100 LOC) — replaces filterTabs in library-toolbar.tsx
  ├─ library-toolbar.tsx        — simplified to search + sort + identity-settings only
  ├─ library-segment-row.tsx    — recomposed using cells/
  ├─ cells/
  │    ├─ health-cell.tsx       NEW (~80 LOC)
  │    ├─ trend-cell.tsx        NEW (~80 LOC) — sparkline SVG
  │    └─ destinations-cell.tsx NEW (~100 LOC) — chip cluster from activations[]
  ├─ library-kpi-tiles.tsx      DELETED
  └─ use-refresh-logs.ts        NEW (~80 LOC) — bulk-fetch hook

server/src/routes/segments.ts   — add GET /segments/:id/refresh-log handler
server/src/jobs/refresh-segment.ts — write segment_refresh_log row on success
server/src/db/migrations/005-refresh-log.sql NEW
```

## Related Code Files

**Create**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-meta-line.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-filter-pills.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/cells/health-cell.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/cells/trend-cell.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/cells/destinations-cell.tsx`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/use-refresh-logs.ts`
- `/Users/lap16299/Documents/code/cube-playground/server/src/db/migrations/005-refresh-log.sql`

**Modify**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-view.tsx` (orchestrate new components, drop KpiTiles import)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-toolbar.tsx` (remove filterTabs — moved into library-filter-pills)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-segment-row.tsx` (recompose with cells)
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/segments.module.css` (row grid columns, new cell styles, sentence-case sweep)
- `/Users/lap16299/Documents/code/cube-playground/src/api/segments-client.ts` (add `refreshLog` + bulk `refreshLogs`)
- `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts` (add `GET /:id/refresh-log` handler)
- `/Users/lap16299/Documents/code/cube-playground/server/src/jobs/refresh-segment.ts` (insert into segment_refresh_log on success)
- `/Users/lap16299/Documents/code/cube-playground/src/i18n/*` (new keys: `segments.library.filter.broken`, `health.fresh/stale/broken/static`, `usedIn.empty`, remove old kpi.* keys)

**Delete**
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-kpi-tiles.tsx`

## Implementation Steps

1. **Migration 005** — create `segment_refresh_log(id INTEGER PK, segment_id TEXT NOT NULL, ts TEXT NOT NULL, uid_count INTEGER NOT NULL, status TEXT NOT NULL)` + index on `(segment_id, ts DESC)`.
2. **Refresh job write** — `refresh-segment.ts` on success appends a row. Keep insert in same transaction as `segments.last_refreshed_at` update.
3. **Server endpoint** — `GET /segments/:id/refresh-log?days=7` returns ordered array.
4. **Bulk endpoint** — Add `POST /segments/refresh-logs` accepting `{ ids: string[], days: number }` returning `Record<id, LogRow[]>`. Avoids N+1.
5. **API client** — `segments-client.refreshLogs(ids, days)`.
6. **Hook** — `use-refresh-logs.ts` fetches bulk on segment list change. Returns `Map<id, LogRow[]>`.
7. **TrendCell** — Inline SVG sparkline (≤80 LOC). Path generation from `uid_count` array normalized to 80×28 viewbox. Color `var(--chart-1)`. Empty state: `<span class="cell-empty">—</span>`.
8. **HealthCell** — Pure rendering from `segment.status` + `segment.type` + `segment.refresh_cadence_min` + `segment.broken_reason`. Mapping:
   - `predicate` + `fresh` → success dot, label `Fresh`, sub `Live · {cadence}m cadence`
   - `predicate` + `stale` → warning dot, label `Stale`, sub `Live · {cadence}m · refresh overdue`
   - `predicate` + `broken` → destructive dot, label `Broken`, sub broken_reason
   - `manual` → muted dot, label `Static`, sub `Manual upload` (or `From Playground · {age}` if synthesizable)
9. **DestinationsCell** — Render chips from `segment.activations || []`. Empty → `—`. Phase 4 ships the data shape; this phase tolerates missing field gracefully.
10. **FilterPills** — extract from `library-toolbar.tsx`. Add `Broken` pill with destructive dot. Count derivation: filter segments where status === 'broken'.
11. **MetaLine** — `{n} segments · {totalUidsFormatted} users · last refresh {ago}`. Reuse existing `formatCount` from row component (or extract to shared util).
12. **library-view.tsx** — orchestrate: title block + meta line + actions cluster + filter pills + toolbar + table card. Drop `LibraryKpiTiles` import. Bulk-fetch refresh logs after segment list resolves.
13. **CSS** — Update `.tableHead` and `.tableRow` grid-template-columns to `minmax(280px, 2.4fr) 130px 90px 110px 200px 120px 36px`. Add new cell styles per mockup CSS. Sentence-case all column labels.
14. **i18n sweep** — Sentence-case audit all `segments.library.*` strings. Remove kpi keys. Add health labels.
15. **Delete** `library-kpi-tiles.tsx`.

## Todo List

- [x] Migration 005: `segment_refresh_log` table
- [x] Refresh job writes log row (fresh on success, broken on failure)
- [x] Server endpoint: GET `/:id/refresh-log`
- [x] Server bulk endpoint: POST `/segments/refresh-logs`
- [x] API client: `refreshLog(id)` + `refreshLogs(ids, days)`
- [x] `use-refresh-logs.ts` hook
- [x] `health-cell.tsx`
- [x] `trend-cell.tsx` with sparkline SVG
- [x] `destinations-cell.tsx` (empty-state-tolerant; reads `segment.activations[]` once Phase 4 ships)
- [x] `library-filter-pills.tsx` (All / Live / Static / Broken)
- [x] `library-meta-line.tsx`
- [x] Simplify `library-toolbar.tsx` (search + sort + identity-map only)
- [x] Recompose `library-segment-row.tsx` with new cells
- [x] Update `segments.module.css` grid + cell styles
- [x] Update `library-view.tsx` orchestration + bulk refresh-log fetch
- [x] Delete `library-kpi-tiles.tsx`
- [x] i18n sentence-case sweep + new keys (en + vi)
- [ ] Manual QA: above-the-fold ≤ 160 px; all 4 health states render; sparkline shows `—` for new segments (pending)

## Success Criteria

- [ ] Library renders title + meta + filter row + table only (no KPI strip).
- [ ] Above-the-fold height ≤ 160 px at 1440×900.
- [ ] Filter pill counts match underlying data.
- [ ] Broken filter pill renders destructive color when active and at least one broken segment exists.
- [ ] HealthCell shows correct mapping for all 4 states.
- [ ] TrendCell renders sparkline when ≥2 log rows exist; `—` otherwise.
- [ ] DestinationsCell renders `—` until Phase 4 ships chips.
- [ ] All `segments.library.*` i18n strings sentence-case.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `segment_refresh_log` grows unbounded | M | Add `DELETE FROM segment_refresh_log WHERE ts < datetime('now', '-90 days')` at refresh-job end; cap retention to 90d |
| Bulk refresh-log fetch becomes slow with 100+ segments | L | Pagination per-call already returns visible segments; only fetch for what's rendered (use `filtered` array, not raw `segments`) |
| Stakeholders complain about KPI tile removal | M | Aggregate stats preserved in meta line + filter pill counts; flag Monitor tab in Phase 5 as where dashboard-feel lives now |
| Removing `LibraryKpiTiles` breaks any test that imports it | L | Grep test files for the import before delete |
| Sparkline accessibility (decorative SVG) | L | Add `role="img"` + `aria-label="trend up X%"` to SVG; verify with screen reader |
| Sentence-case sweep changes user-facing copy unintentionally | L | Diff i18n files in PR; product reviewer approves before merge |

## Security Considerations

- Refresh-log endpoint must enforce same auth as segment endpoints (owner check or admin).
- SQL injection — use parameterized queries (existing pattern in `segments.ts`).
- Bulk endpoint: cap `ids.length` to e.g. 100 to prevent DoS.

## Next Steps

Unblocks Phase 5 (Detail Monitor uses same `segment_refresh_log` for size trend chart + history table). Phase 4 fills DestinationsCell with real chips.
