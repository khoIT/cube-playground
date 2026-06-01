# Pinned Dashboard Chart Parity

**Date**: 2026-06-01 19:30  
**Severity**: High  
**Component**: Dashboard tiles (server cache + client render engine)  
**Status**: Resolved

## What Happened

Shipped pinned-chart parity: dashboard tiles now render through the exact same chart engine as the QueryBuilder playground, with the ability to toggle chart type live within a dashboard. Previously, pinning a chart to a dashboard collapsed the viz type (area→line), dropped the pivot config, and rendered via a lightweight heuristics-based renderer that only consumed cached rows, never the full Cube response structure.

## The Brutal Truth

This was a quiet data fidelity leak. A user would spend 15 minutes crafting a nuanced area chart with a specific pivot (breakdown by dimension on columns, metric on rows, series ordering), pin it to a dashboard for monitoring, come back tomorrow and see... a line chart with default aggregation. The pinned asset was broken—not visibly broken (it rendered), but functionally broken. No error signal. The decision to take the "enrich cache + real renderer" approach (not live-query-per-tile, not minor heuristic tweaks) meant accepting complexity: the tile now depends on the full Cube /load response, which is slower to persist and render than the lightweight path. Worth it, but the coupling is tighter now.

## Technical Details

**Schema**: Migration 026 adds three columns:
- `dashboard_tiles.chart_type` (TEXT): line|bar|area|table|number|pie (coalesce to legacy viz_type for backward-compat).
- `dashboard_tiles.pivot_config` (TEXT): serialized Cube PivotConfig (row/column member distribution).
- `dashboard_tile_cache.resp_json` (TEXT): the entire Cube /load response (`{ results: [{ annotation, data }] }`).

**Server refresh cron**: `refresh-dashboard-tiles.ts` now passes the full loadResponse (not just rows) to `upsertTileCache()`. The cache store uses COALESCE when updating — if rows are unchanged, resp_json is still refreshed so pre-migration tiles auto-upgrade.

**Client tile render**:
1. If cache has `loadResponse` AND passes a shape check (`isRenderableLoadResponse`), rebuild a real `new ResultSet(loadResponse)` and render via PlaygroundChartRenderer (the same chart engine as the QB).
2. Include a ResizeObserver hook to feed the chart engine a numeric `contentRect.height` (charts require a concrete height, not a stretch-fill container).
3. Wire a ChartTypeToggle that toggles `chartType` state and PATCHes `/api/dashboards/:slug/:tileId` live.
4. Wrap the chart engine in `TileChartBoundary` (error boundary) — the engine reads `loadResponse.results[0].data` and calls `chartPivot()` at render, not setup time, so a malformed/partial response can construct but throw during render. Without the boundary that error would unmount the whole dashboard grid.
5. Legacy tiles (no loadResponse) use the lightweight rows→ResultSet-ish fallback. They auto-upgrade on the next cron refresh.

**API**: GET `/api/dashboards/:slug` embeds `loadResponse` in each tile's `cache` object. PATCH `/api/dashboards/:slug/:tileId` accepts `{ chart_type, pivot_config }` (both optional) and returns the updated tile spec (persists immediately, separate from cron).

## What We Tried

1. **Live-query-per-tile**: Rejected — adds per-tile latency (6–8 tiles × 500ms avg = 4–6s dashboard load). Unacceptable for a monitoring dashboard.
2. **Upgrade heuristics (inferVizType)**: Tried in phase 2 — converting area→line, inferring series grouping from raw rows. Rejected — never recovered the true intent. A 2D pivot with 20 dimensions is unrecoverable from rows alone.
3. **Lightweight cache enrichment**: Initial exploration — store only metadata (chart_type, series names). Rejected — ChartRenderer needs the full annotation (key aliases, time granularity, type info) to call `chartPivot()` correctly.
4. **Enrich cache + real renderer**: Accepted. Trade-off: resp_json bloats cache rows (8-tile cap → ~64KB–200KB GET payload, but we already load tiles lazily so the impact is mild). Complexity in error handling is real (needed the boundary).

## Root Cause Analysis

The original design separated concerns: the tile cache held rows (the "rendered result"), and the tile renderer was a dumb rows-to-HTML formatter. Pinning didn't carry metadata because the assumption was "rows are enough." That broke the moment a chart's visual intent depended on the Cube response structure (pivot, series, grouping, type info). The fix required pushing the full response into the cache — a schema change, two new GET fields, and a client error boundary.

Why the error boundary was necessary: the chart engine doesn't just read structured data — it calls `chartPivot()` at render time to transpose the result set. If the stored response was incomplete (e.g., missing annotation), construction would succeed but rendering would throw. A try/catch around `new ResultSet()` alone is insufficient.

## Lessons Learned

1. **Response shape matters more than row content.** For any data pipeline that feeds a visual engine, persisting just the rows loses metadata. The Cube `/load` response is the minimal sufficient contract; anything less requires inference or degradation.

2. **Render-time throws are silent data loss.** A component that throws during render unmounts its parent in React 18+ without a boundary. For a dashboard with 8 tiles, one poisoned chart silently nukes the grid. Every data consumer that does work at render time (not setup) needs an error boundary.

3. **COALESCE on schema migrations is cheap insurance.** When adding a non-null column, pushing data in via an UPDATE that COALESCEs the new column means old cached entries pick up the enrichment on the next refresh without a separate migration script. Lowered risk and simplified the deploy.

4. **Chart-type toggle persistence is fragile to race conditions.** An optimistic toggle (local state + PATCH) can flicker if a cron refresh and a user toggle happen within ~100ms. Acceptable for a monitoring context (user can re-click), but a future version should either debounce or implement a multi-turn sync.

5. **Backward-compat via graceful fallback.** Legacy tiles (missing loadResponse) render the old way. The fallback is not a crutch — it's a recovery path. On the next cron run (default 5min), the tile auto-upgrades. No manual migration, no breakage.

## Next Steps

1. **Tile chart-type toggle visibility**: Currently toggles line/bar/area/table only. Pie and number tiles render but show no toggle. Decide: hide toggle for pie/number, or extend it to support swapping (pie ↔ table, number ↔ bar). Tie to a future business question about pinned KPI dashboards.

2. **Payload size monitoring**: GET `/api/dashboards/:slug` now carries both rows + loadResponse per tile. With an 8-tile cap and modern Cube returning ~100KB per response, this is ~800KB per dashboard fetch. Monitor in prod; if it exceeds network budget, consider a `?fields=` query param to skip loadResponse on list views.

3. **Dependency on Cube response shape**: The `isRenderableLoadResponse` precheck guards against malformed responses, but assumes Cube returns `{ results: [{ data, annotation }] }`. If Cube team changes the response envelope, the precheck fails silently and tiles fall back to rows (correct behavior, but a log entry would help ops triage). Add a metric: `tiles_fallback_to_legacy_renderer`.

4. **Chart-type toggle race condition**: If you're building real-time monitoring on this, consider a debounce + cron-safe merge logic so concurrent updates to chart_type don't collide. Acceptable for now (manual re-click recovery), but flag in design review if toggling is part of a larger automation feature.

## Unresolved Questions

- **Pie/number toggle coverage**: Should pinned pie/number charts allow toggling to other types (e.g., table), or stay locked? Depends on upcoming use cases (e.g., pinned cohort size vs. distribution pie chart).
- **Refresh semantics**: If a user toggles chart type from line→area, then the cron refreshes, does the chart re-render with the new data still as area? (Yes, toggle persists and takes precedence over inferred viz_type.) Should this be documented in the refresh-tile path?
- **Error telemetry**: No gauge yet for how often TileChartBoundary catches an error and falls back. Worth adding if dashboard stability becomes a support topic.
