---
phase: 4
title: "Dashboard pin persistence"
status: pending
priority: P2
effort: "1.5d"
dependencies: [3]
---

# Phase 4: Dashboard pin persistence

## Overview

Pin a merged dual-axis chart to a Dashboard tile and re-render it there. Research + red-team found
the tile store has a **single `query_json` slot**, one cached `resp_json` per tile, and a refresh
job that loads exactly one query — so this needs a real dual-load + cache path, not just a column.

## Requirements

- Functional: "Pin to Dashboard" from a builder session with an `overlayQuery` persists both queries;
  the dashboard tile reloads both, merges on date value, and renders the same embedded
  `AssistantChartSection` dual-axis.
- Non-functional: existing single-query tiles unaffected; new column nullable/back-compat.

## Architecture

- **Schema — ONE column (red-team M12):** add nullable `overlay_query_json` to `dashboard_tiles`
  (additive migration, domain-slug filename). **Reuse the existing `chart_type` discriminator**
  (added in `server/src/db/migrations/026-dashboard-tile-chart-metadata.sql`) — set
  `chart_type='dual-axis'`. Do NOT add a separate `chart_mode` column.
- **Cache slot for the overlay (red-team H9):** the tile cache (`dashboard_tile_cache.resp_json`,
  `migrations/010-dashboards.sql`) holds ONE response per tile. Add a second response slot
  (`overlay_resp_json`) OR store the pre-merged rows; pick the smaller change after reading the
  cache schema. The refresh job `server/src/jobs/refresh-dashboard-tiles.ts:73-85` currently loads
  one `query_json` — extend it to also load `overlay_query_json` when present and cache both.
- **Pin modal** (`src/pages/Dashboards/pin-to-dashboard-modal.tsx`): when the builder has
  `overlayQuery`, include `overlay_query_json` + `chart_type='dual-axis'` in the pin payload.
- **Tile render** (`src/pages/Dashboards/tile.tsx:150-279`): when `chart_type==='dual-axis'` /
  `overlay_query_json` present, take both cached responses, merge via the shared
  `src/charts/merge-on-date-value.ts` (Phase 3), and render embedded `AssistantChartSection` (same
  renderer as chat + builder). Otherwise the existing single `PlaygroundChartRenderer` path.

## Related Code Files

- Create: dashboard migration `NNN_dashboard_tile_overlay_query.up.sql` (+ down) — domain slug only
- Modify: `server/src/jobs/refresh-dashboard-tiles.ts` (dual-load + cache both)
- Modify: dashboard tile API route (persist/read `overlay_query_json`)
- Modify: `src/pages/Dashboards/pin-to-dashboard-modal.tsx` (include overlay + chart_type)
- Modify: `src/pages/Dashboards/tile.tsx` (dual-axis render branch, reuse embedded AssistantChartSection)
- Read: `src/charts/merge-on-date-value.ts`, `server/src/db/migrations/010-dashboards.sql`, `026-…`

## Implementation Steps

1. Locate tile table + cache schema; add `overlay_query_json` (and the overlay cache slot).
2. Refresh job: load both queries when overlay present; cache both responses.
3. Pin modal: thread overlay + `chart_type='dual-axis'` into the pin payload.
4. Tile render: dual-axis branch merges both cached responses → embedded AssistantChartSection.
5. Round-trip test: pin merged chart → reload dashboard → tile renders dual-axis from storage.

## Success Criteria

- [ ] Pinning a merged chart persists `overlay_query_json` + `chart_type='dual-axis'`.
- [ ] Refresh job loads BOTH queries; reloaded tile renders the merged bar+line without chat/builder context.
- [ ] Pre-existing single-query tiles render identically (migration back-compat).

## Risk Assessment

- **Refresh-budget doubling:** a dual-axis tile costs two `/load`s per tick — confirm the tile-refresh
  Cube-load budget tolerates it (plan.md open question 3).
- Cache schema: prefer the smallest change (second resp slot vs stored merged rows) after reading it.
- Migration additive + nullable; old tiles read as single; filename domain-slug only (no phase/finding labels).
