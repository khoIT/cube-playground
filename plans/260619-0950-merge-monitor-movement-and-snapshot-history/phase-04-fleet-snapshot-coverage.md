---
phase: 4
title: "Fleet \"Snapshot coverage\" page"
status: done
priority: P3
effort: "1d"
dependencies: [3]
---

# Phase 4: Fleet "Snapshot coverage" page

## Overview
A new top-level page listing ALL segments' snapshot availability: Track cadence, grains
available, history depth, last snapshot, and a per-row mini coverage strip.
The cross-segment answer to "which grain/cadence is available for each segment". Phased
follow-up — independent of the per-segment merge.

## Requirements
- Functional: `GET /api/segments/snapshot-coverage` → one row per predicate+game segment:
  `{ segmentId, name, gameId, trackCadence, grains[], depthDays,
  lastSnapshotTs, eras[] }`. Page: header summary band (total / # sub-daily / # stale-or-none,
  warning tone), capture filter pills (all / sub-daily / none), sortable Depth + Last
  snapshot, rows clickable → that segment's Monitor tab. Mini strip per row.
- Non-functional: ONE aggregate pass over the lakehouse (not N per-segment queries); bounded;
  serve-stale; cached (coverage changes slowly).

## Architecture
- Reader `readSnapshotCoverageFleet`: aggregate over `SEGMENT_KPI_DAILY` grouped by
  `(segment_id)` for `MIN/MAX(snapshot_date)` (depth), `MAX(snapshot_ts)` (last), and the
  distinct ts set per segment (for grains/eras). Join segment metadata (name, cadences) from
  SQLite `segments` (the route already has DB access). Stale "no snapshot" = segments with a
  game but zero rows / last beyond expected cadence.
- Route returns the joined fleet rows; cadence + name come from SQLite, availability from
  lakehouse — assemble in the route. Reuse `computeCaptureEras`/`finestEraCadence` per segment.
- New page `src/pages/Segments/snapshot-coverage/index.tsx` (page-header pattern, maxWidth
  1200, table in `overflow-x:auto`); mini-strip component reuses strip tokens. Add nav entry
  + route registration alongside the segments routes.

## Related Code Files
- Modify: `server/src/lakehouse/segment-movement-reader.ts` (or new
  `segment-coverage-reader.ts` if >200 LoC), `server/src/routes/segment-movement.ts`
  (or new route file), app router + nav config, `src/api/segment-movement-client.ts`
- Create: `src/pages/Segments/snapshot-coverage/index.tsx`, mini-strip component, fleet test
- Reuse: era helpers, `cadence-coverage-strip` styling (mini variant), grain chips

## Implementation Steps
1. `readSnapshotCoverageFleet` aggregate (depth/last/ts-set per segment, single query).
2. Route assembles lakehouse availability + SQLite cadence/name; cache + serve-stale.
3. Page: summary band + filter pills + sortable table + mini strips + row link-out.
4. Register route + nav entry. Empty/stale tones per `snapshot-fleet-overview.html`.
5. Tests: reader aggregate shape + route assembly (mocked DB + lakehouse). Build green.

## Todo List
- [x] readSnapshotCoverageFleet (single aggregate) — `readSnapshotCoverageTimestamps`:
      ONE Trino pass over distinct (segment_id, snapshot_ts); grouped in memory.
- [x] route (lakehouse + SQLite join, cached, serve-stale) — visibility guard
      mirrors GET /api/segments; cache keyed per workspace+role+sub.
- [x] snapshot-coverage page (summary, filters, sortable table, mini strips)
- [x] nav + route registration; row → segment Monitor (`?tab=monitor`)
- [x] tests + tsc + suites green — HTTP-level access-control tests added
      (non-admin/admin visibility, per-principal cache isolation, ledger guards).

## Implementation notes
- `game_id` is NOT NULL in the segments schema, so every predicate segment has a
  game and is snapshot-eligible. The mockup's "no game / manual" row is therefore
  illustrative only — the fleet route lists **predicate** segments (which always
  carry a game); manual segments are out of scope for snapshot coverage.
- Fleet window fixed at 31 days (COVERAGE_WINDOW_DAYS) — depth/last/eras reflect
  the last 31 days, which is plenty for a slow-changing, cached fleet view.
- Stale-tail visual on the mini-strip was dropped (YAGNI): staleness is carried
  by the "Last snapshot" column tone, so the strip paints captured eras only.

## Success Criteria
- [ ] Page matches `snapshot-fleet-overview.html`; mixed states render (15m/1h/daily/off/stale)
- [ ] One aggregate query powers all rows (no N+1)
- [ ] Filters + sort work; row click deep-links to the right segment+tab
- [ ] Stale/no-snapshot segments flagged in warning tone

## Risk Assessment
- N+1 trap: must aggregate in one query, not per-segment loops.
- Segment list can be large → paginate or cap + "showing N"; keep the aggregate partition-
  pruned by game_id where possible.
- maxWidth vs wide table: open question — scroll-in-wrapper at 1200 (mockup) vs widen shell.

## Security Considerations
- Counts/cadence/dates only — no member data. Respect segment visibility/ACL: only list
  segments the caller may read (apply the same guard as the segments list endpoint).
