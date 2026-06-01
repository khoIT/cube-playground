# Pinned chart parity with QueryBuilder

Make a pinned dashboard tile mirror the QueryBuilder chart exactly (chart type, pivot,
series) AND expose a chart-type toggle in the dashboard view that persists.

## User decisions (locked)
- **Render approach: enrich cache + real renderer.** Server stores the full Cube
  loadResponse; client rebuilds a real `ResultSet` and renders via the SAME
  `PlaygroundChartRenderer` as QB. Keeps cache-based dashboard load (no per-tile live query).
- **Toggle persists.** Switching chart type in the dashboard PATCHes the tile's `chart_type`.

## Root cause (verified)
- Pin is lossy: `inferVizType` collapses area→line, drops `pivotConfig` (`pin-to-dashboard-button.tsx:14`).
- Tile renders cached `rows` through heuristics, not the QB engine — fake `ResultSet` with only `rawData`/`tablePivot` (`tile.tsx:56`, `tile-viz-renderers.tsx`).
- Cache stores only `rows_json`, no annotation (`dashboard-tile-cache-store.ts`); refresh discards the full loadResponse (`refresh-dashboard-tiles.ts:76` keeps only `rowsFrom(res)`).

## Status: implemented — server 572 tests green, frontend 432 (dashboards+QB) green; tsc clean on touched files.

## Phases
- [x] **phase-01 (server data)** — migration: `dashboard_tiles += chart_type, pivot_config`; `dashboard_tile_cache += resp_json`. cache-store persists/reads loadResponse. refresh job stores full `res`.
- [x] **phase-02 (server api)** — `dashboard-store` add/patch + select `chart_type`/`pivot_config`; `routes/dashboards` schemas accept them; GET embeds `loadResponse` in cache view.
- [x] **phase-03 (client capture)** — `dashboards-client` types; `pin-to-dashboard-button` + `pin-to-dashboard-modal` capture full `chartType` + `pivotConfig`.
- [x] **phase-04 (tile render + toggle)** — `tile.tsx`: rebuild `new ResultSet(loadResponse)` → `PlaygroundChartRenderer` with persisted chart_type + pivot_config; chart-type toggle in header → PATCH. Legacy tiles (no loadResponse) fall back to existing `TileVizBody`.
- [x] **phase-05 (tests + verify)** — cache-store + route tests for new fields; tsc; vitest green.

## Key files
server: db/migrations/NNN-*.sql, services/dashboard-tile-cache-store.ts, jobs/refresh-dashboard-tiles.ts, services/dashboard-store.ts, routes/dashboards.ts
client: api/dashboards-client.ts, pages/Dashboards/{pin-to-dashboard-button,pin-to-dashboard-modal,tile,tile-viz-renderers}.tsx, QueryBuilderV2/components/chart-type-toggle.tsx (reuse), QueryBuilderV2/components/ChartRenderer.tsx (PlaygroundChartRenderer, reuse)

## Backward compat
Legacy tiles have no `chart_type`/`pivot_config`/`loadResponse` → default chart_type from viz_type, pivot_config null, render via existing rows-based `TileVizBody`.
