# Phase 01 — Segment overlap & compare

## Context links

- Plan: [plan.md](plan.md)
- Mockup: feature 1 (Venn + delta tiles + per-region metric table + save-region).
- Snapshot writer: `server/src/lakehouse/segment-snapshot-writer.ts`
- Routes: `server/src/routes/segments.ts`
- Library bulk toolbar: `src/pages/Segments/library/bulk-actions-toolbar.tsx`

## Overview

- **Priority:** P1 (highest value).
- **Status:** done.
- **Description:** Pick two segments → overlap count + Venn (area ∝ size) + delta
  tiles (A-only / both / B-only + Jaccard) + per-region metric table + "save any
  region as a segment". Set math runs on the nightly Iceberg membership snapshot,
  NOT a live Cube query.

## Key insights (verified)

- Snapshot table `stag_iceberg.khoitn.segment_membership_daily` holds full cohorts
  per `(snapshot_date, game_id, segment_id, uid)` — written by
  `writeSegmentSnapshot` (`segment-snapshot-writer.ts:139`). One row per uid; no
  measures. Intersect two segments' latest-partition uid sets in Trino with a
  single `INNER JOIN` / `EXCEPT` — counts come back without shipping uids to app.
- Lakehouse connector + schema helpers already exist:
  `server/src/lakehouse/lakehouse-trino-connector.ts`
  (`lakehouseConnectorFromEnv`, `lakehouseSchemaForGame`, `SEGMENT_MEMBERSHIP_DAILY`,
  `LAKEHOUSE_STATEMENT_TIMEOUT_MS`); query runner `runQuery` in
  `server/src/services/trino-rest-client.ts`. Reuse — do NOT add a new connector.
- Manual-segment create is `POST /api/segments` with `type:'manual'` + `uid_list`
  → stored as `uid_list_json` (`segments.ts:428`, count = `uidList.length`,
  status `'fresh'`, no refresh). This IS the save-region write path. No new path.
- Tokenless members API `GET /api/segments/:id/members` (`segments.ts:657`) is the
  per-region preview-rows source AFTER a region is saved (it has a segment id).
  For pre-save region preview, page the JOIN result directly.
- FE: new route `/segments/compare`; reuse `CardShell`
  (`src/pages/Segments/detail/cards/card-shell.tsx`), KPI-tile pattern
  (`src/pages/Segments/detail/components/stats-row.module.css`), `Tag`
  (`src/pages/Segments/visuals/tag.tsx`), and `visuals.module.css` tokens.
- Reach: add a "Compare 2 selected" action to `BulkActionsToolbar`
  (`bulk-actions-toolbar.tsx:60`), enabled only when exactly 2 are selected;
  `history.push('/segments/compare?a=<id>&b=<id>')` (history available in
  `library-view.tsx`).

## Requirements

Functional:
- Given two segment ids (+ game), return: `aOnly`, `both`, `bOnly` counts, sizes
  of A and B, Jaccard, and each segment's snapshot timestamp + staleness flag.
- Render Venn with circle area ∝ cohort size and overlap to scale; delta KPI tiles;
  staleness callout when a partition is > 24h old.
- Per-region metric table (deferred load) — avg LTV / active days / median last
  seen per region, with a measure toggle. See unresolved Q1 in plan.md.
- Save A-only / both / B-only as a new MANUAL segment (full region uid set).

Non-functional:
- Counts query must run in Trino (set ops on snapshot), never a live cohort scan.
- Both segments must share the same game (cross-game overlap is meaningless) —
  reject with a clear error otherwise.

## Architecture

Data flow (counts):
```
FE /segments/compare?a&b
  → GET /api/segments/compare?a=<id>&b=<id>
      server: load both segment rows (id→game_id), assert same game
      → resolve latest snapshot_date per (game, segment) from the table
      → ONE Trino query: counts of A∩B, A\B, B\A over latest partitions
      → return counts + sizes + snapshot_ts + stale flag
  ← FE renders Venn + tiles + (deferred) metric table
```
Data flow (save region):
```
FE "Save <region>" → GET region uids (paged) → POST /api/segments
   { type:'manual', name, game_id, cube, uid_list }  (existing path)
```
Region-uid retrieval for save: a server endpoint returning the region's uids
(paged) so the FE can assemble `uid_list` — OR have the save endpoint accept the
two segment ids + region selector and do the JOIN + manual-create server-side
(preferred: avoids shipping 40k uids to the browser and back). Implement the
server-side region-save variant.

## Related code files

Create:
- `server/src/lakehouse/segment-overlap-counts.ts` — builds + runs the Trino set-op
  count query over the two latest partitions; returns counts/sizes/Jaccard/ts.
  (< 200 lines; pure SQL builder + runner, unit-testable with injected connector.)
- `server/src/routes/segment-compare-routes.ts` — `GET /api/segments/compare`
  (counts) + `POST /api/segments/compare/save-region` (JOIN region uids →
  reuse manual-create). Register in the same place other segment routes register.
- `src/pages/Segments/compare/compare-view.tsx` — page shell + data wiring.
- `src/pages/Segments/compare/overlap-venn.tsx` — hand-rolled SVG Venn (area ∝
  size, tokens only; matches mockup geometry).
- `src/pages/Segments/compare/region-delta-tiles.tsx` — KPI tiles (A-only/both/
  B-only + Jaccard) reusing the stats-row tile pattern.
- `src/pages/Segments/compare/region-metric-table.tsx` — deferred per-region
  metric table with measure toggle.
- `src/pages/Segments/compare/use-segment-overlap.ts` — fetch hook.
- `src/api/segment-compare-client.ts` — typed client for the two endpoints.

Modify:
- `server/src/routes/segments.ts` OR the route registrar — register the new routes
  (verify the registration site; segments routes are registered as one plugin).
- `src/pages/Segments/library/bulk-actions-toolbar.tsx` — add "Compare 2 selected"
  (visible/enabled only when `selected.length === 2`).
- `src/pages/Segments/library/library-view.tsx` — pass navigate handler if the
  toolbar doesn't already own `useHistory`.
- App router (where `/segments/*` routes mount) — add `/segments/compare`.

Delete: none.

## Implementation steps

1. **Server set-op SQL** — `segment-overlap-counts.ts`: resolve latest
   `snapshot_date` per (game, segment); build a single Trino statement computing
   the three region counts + both segment sizes (use `count(*)` over a join /
   `EXCEPT`/`INTERSECT`, or conditional aggregation on a `FULL OUTER JOIN`).
   Return `{ aSize, bSize, aOnly, both, bOnly, jaccard, aSnapshotTs, bSnapshotTs }`.
2. **Server route** — `segment-compare-routes.ts`: `GET /api/segments/compare`:
   load both rows, assert same `game_id`, call the counts builder, compute
   staleness (now − snapshot_ts > 24h), return JSON.
3. **Server save-region** — `POST /api/segments/compare/save-region`: body
   `{ a, b, region: 'aOnly'|'both'|'bOnly', name }`; run the region JOIN to
   collect uids, then call the SAME manual-create logic (extract the create body
   into a shared helper if cleaner, or call `POST /api/segments` internals).
   Return the new segment id.
4. **FE client + hook** — `segment-compare-client.ts` + `use-segment-overlap.ts`.
5. **FE page** — `compare-view.tsx`: read `?a&b`, fetch counts, lay out picker row
   + Venn + tiles + (deferred) metric table per mockup, all tokens.
6. **FE Venn** — `overlap-venn.tsx`: radii from sqrt(size); center offset from
   overlap ratio; chart-1/chart-2 fills at the mockup's opacities (CSS vars).
7. **FE save** — wire each "Save <region>" button → save-region endpoint → toast
   + navigate to the new segment detail.
8. **Reach** — add the toolbar action + route.
9. **Metric table** — deferred load behind a measure toggle (see Q1: cap/sample
   the region IN-list; confirm exact-vs-sampled with user before finalizing).
10. **Verify** `npx tsc --noEmit` clean; run vitest.

## Todo checklist

- [ ] `segment-overlap-counts.ts` SQL builder + runner
- [ ] `GET /api/segments/compare` route + same-game guard + staleness
- [ ] `POST /api/segments/compare/save-region` (server-side JOIN → manual-create)
- [ ] FE client + fetch hook
- [ ] `compare-view.tsx` page
- [ ] `overlap-venn.tsx` (area ∝ size)
- [ ] `region-delta-tiles.tsx`
- [ ] `region-metric-table.tsx` (deferred + measure toggle)
- [ ] "Compare 2 selected" in bulk toolbar + `/segments/compare` route
- [ ] Tests (below) + `tsc --noEmit` clean

## Success criteria

- Selecting exactly 2 segments in the library shows "Compare 2 selected" →
  opens `/segments/compare?a&b`.
- Counts (A-only / both / B-only / Jaccard) match a manual Trino set-op on the
  two latest partitions.
- Venn circle areas are proportional to cohort sizes; overlap region scales.
- A stale (>24h) partition shows the staleness callout from the mockup.
- "Save <region>" creates a manual segment whose `uid_count` equals the region
  count, reachable in the library.
- Cross-game pair returns a clear error, not a wrong overlap.

## Tests to write

- `segment-overlap-counts` builder: SQL shape + counts against an injected
  connector returning fixture rows (A∩B, A\B, B\A).
- Route: same-game guard rejects cross-game; staleness flag flips at the 24h
  boundary; missing-partition segment surfaces "no snapshot yet" not a 500.
- save-region: region selector maps to the correct uid set; created segment is
  `type:'manual'` with the right `uid_count`.
- FE: Venn radii scale with size; tiles render counts + Jaccard; toolbar action
  appears only at exactly 2 selected.

## Risks + mitigation

| Risk | L×I | Mitigation |
|------|-----|-----------|
| One segment has no recent snapshot partition | M×H | Detect missing latest partition; show "no snapshot yet" empty state, don't 500. |
| Large region (40k+) save-as-segment | M×M | Do the JOIN + create server-side; never ship uids through the browser. Confirm manual-create tolerates large `uid_list` (Q2). |
| Per-region metric exactness vs cost | M×M | Deferred on-demand load; cap/sample IN-list; confirm exact-vs-sampled with user (Q1). |
| Snapshot is non-atomic (DELETE then INSERT) → empty partition window | L×M | Writer's own count distinguishes silent-empty; surface "snapshot mid-write" via the stale/empty path. |
| Cross-game overlap | L×H | Hard guard: assert same `game_id` before any set op. |

## Security / perf considerations

- Reuse the existing auth/workspace guards that other `/api/segments` routes use;
  the *counts* read should require auth (it's an authoring surface, unlike the
  deliberately-tokenless members pull). Verify visibility rules: a user must be
  able to read both segments to compare them.
- One Trino set-op query per compare (cheap on the indexed snapshot table); the
  metric table is the only potentially-heavy read — keep it deferred + capped.
- save-region must respect `visibility` defaults like the normal create path.

## Next steps

- Independent of other phases. Unblocks nothing else but is highest value.
