---
phase: 3
title: "Saved dashboards"
status: completed
priority: P1
effort: "2-3d"
dependencies: [1]
---

# Phase 3: Saved dashboards

## Overview

Let users pin any playground query as a tile and arrange tiles on a `/dashboards/:slug` grid (≤8 tiles per dashboard). Persists to existing sqlite server. Multiplies the value of every other phase — KPI tiles, anomaly drill-throughs, diff views all become pinnable.

## Requirements

**Functional**
- "Pin to dashboard" button in playground result toolbar — opens a small modal: pick existing dashboard or create new (slug + title).
- Tile model: `{ id, dashboardId, title, query: CubeQuery, vizType: 'table'|'line'|'bar'|'kpi', position: { x, y, w, h } }`.
- Grid layout: react-grid-layout, 12-col grid, ≤8 tiles, drag-resize, save on blur.
- Per-game scoping: a dashboard belongs to a game; switching `GamePicker` re-renders with same tiles but new game's data.
- CRUD endpoints under `/api/dashboards` (Fastify). Owner = `X-Owner` header (matches existing pattern).
- Title editing inline; slug auto-derived from title, unique per `(owner, game)`.

**Non-functional**
- Tile fetches share a single throttled queue to avoid 8 concurrent Cube requests.
- Layout save debounced 500ms.
- ≤8 tile cap enforced server-side (return 409 with reason).

## Architecture

```
sqlite (migration 009-dashboards.sql):
  dashboards (
    id INTEGER PK,
    owner TEXT NOT NULL,
    game TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner, game, slug)
  );

  dashboard_tiles (
    id INTEGER PK,
    dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    query_json TEXT NOT NULL,         -- serialized Cube Query
    viz_type TEXT NOT NULL,
    position_json TEXT NOT NULL,      -- { x, y, w, h }
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX dashboard_tiles_dashboard_id ON dashboard_tiles(dashboard_id);

Server routes (server/src/routes/dashboards.ts):
  GET    /api/dashboards?game=<id>          → list (owner-scoped)
  POST   /api/dashboards                    → create { game, slug, title }
  GET    /api/dashboards/:slug?game=<id>    → detail with tiles[]
  PATCH  /api/dashboards/:slug              → { title }
  DELETE /api/dashboards/:slug

  POST   /api/dashboards/:slug/tiles        → add tile (enforce ≤8)
  PATCH  /api/dashboards/:slug/tiles/:id    → { title?, position?, vizType? }
  DELETE /api/dashboards/:slug/tiles/:id
  PUT    /api/dashboards/:slug/layout       → batch update positions

Frontend:
  /dashboards                → list of dashboards for active game
  /dashboards/:slug          → grid view
  <PinToDashboardButton> in playground toolbar
  <DashboardGrid> uses react-grid-layout
  <Tile> renders based on vizType: <KpiTile> | <LineChart> | <BarList> | result table
```

Pin button reads current playground query state, opens modal, POSTs tile to chosen dashboard.

## Related Code Files

- **Create**
  - `server/src/db/migrations/009-dashboards.sql`
  - `server/src/routes/dashboards.ts`
  - `server/src/services/dashboard-store.ts`
  - `src/pages/Dashboards/index.tsx` — list page
  - `src/pages/Dashboards/dashboard-detail.tsx` — grid view
  - `src/pages/Dashboards/dashboard-grid.tsx` — react-grid-layout wrapper
  - `src/pages/Dashboards/tile.tsx` — viz dispatcher
  - `src/pages/Dashboards/pin-to-dashboard-button.tsx`
  - `src/pages/Dashboards/pin-to-dashboard-modal.tsx`
  - `src/pages/Dashboards/use-dashboards.ts`
  - `src/pages/Dashboards/use-dashboard-detail.ts`
- **Modify**
  - `src/App.tsx` — register `/dashboards`, `/dashboards/:slug`
  - `src/QueryBuilder/...` (or `QueryBuilderV2`) — mount `<PinToDashboardButton>` in result toolbar
  - `package.json` — add `react-grid-layout` (~30 KB gz)
- **Reuse (no edit)**
  - `src/pages/Segments/visuals/*` for tile rendering
  - existing `X-Owner` middleware pattern

## Implementation Steps

1. Migration 009: `dashboards` + `dashboard_tiles` with FK cascade.
2. `dashboard-store.ts`: prepared statements for CRUD; enforce ≤8 tiles in `addTile`.
3. `dashboards.ts` route: standard Fastify handlers; reuse `X-Owner` pattern from `presets.ts`/`segments.ts`.
4. Frontend list + detail pages; URL-state for `/dashboards/:slug`.
5. `<DashboardGrid>` wraps `react-grid-layout`; persists layout on blur with 500ms debounce.
6. `<Tile>`: reads tile.query, calls `cubeApi.load` via shared throttled queue (max 3 concurrent).
7. `<PinToDashboardButton>` in playground toolbar; modal lists existing dashboards or "Create new…".
8. Tile delete (small kebab on hover); title rename inline.
9. Tests: tile CRUD round-trip; ≤8 enforcement; layout save debounced and merged.

## Success Criteria

- [ ] Pinning from playground creates a tile on selected dashboard.
- [ ] Grid drag-resize persists across reloads.
- [ ] ≤8 tile cap returns 409 with readable error in UI.
- [ ] Game switch re-renders tiles with new game token (no leak).
- [ ] All tile fetches throttled (≤3 concurrent observed in network tab).
- [ ] Delete cascades tiles when dashboard removed.

## Risk Assessment

- **Risk:** react-grid-layout adds bundle weight.
  **Mitigation:** lazy-load via `loadable.tsx` (already in codebase) on `/dashboards/*` only.
- **Risk:** stale Cube query schemas break tiles silently.
  **Mitigation:** tile renders "schema drift" warning when measure/dim disappears from meta; existing `drift-resolver.ts` is precedent for this.
- **Risk:** multi-user write conflicts on layout.
  **Mitigation:** `updated_at` last-writer-wins for demo; document the limit. Real collab is out of scope.
- **Risk:** 8-tile demo cap feels arbitrary in showcase.
  **Mitigation:** raise to 12 if perf testing allows; or document "ops view, not BI dashboard" framing.
