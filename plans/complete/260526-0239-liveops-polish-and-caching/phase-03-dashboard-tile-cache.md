---
phase: 3
title: "Dashboard tile cache"
status: pending
priority: P1
effort: "1-2d"
dependencies: [2]
---

# Phase 3: Dashboard tile cache

## Overview

Mirror Phase 2's caching pattern for dashboard tiles. Each pinned tile has a known `query_json` + viz_type; cron pre-fetches results to sqlite; frontend reads cached rows. ≤8 tiles × N dashboards still means a finite, knowable refresh-set.

## Why

- A dashboard page open currently fires up to 8 concurrent Cube queries (throttled to 3 by `tile-fetch-queue.ts`).
- Dashboards are durable artifacts — analysts return to them daily. Refreshing the same 8 tiles per visit is wasteful.
- Pre-warmed tiles make dashboards feel "instant" — biggest single demo win for the feature.

## Requirements

**Functional**
- New cache table keyed by `tile_id` (FK to `dashboard_tiles.id` with `ON DELETE CASCADE`).
- TTL configurable per dashboard (default 5 min). Settable via `PATCH /api/dashboards/:slug` body `{ tile_ttl_seconds }`.
- Cron refreshes tiles on `dashboards` that have been viewed in the last 7 days. Idle dashboards don't get refreshed (saves Trino).
- API:
  - `GET /api/dashboards/:slug?game=<id>` — extended to include cached `rows`, `fetched_at`, `status` per tile (frontend reads, no per-tile fetch).
  - `POST /api/dashboards/:slug/tiles/:id/refresh` — force refresh now.
  - Tile create/update auto-triggers a one-shot refresh so analysts see data immediately.
- Schema-drift handling: when a tile's measure/dim disappears from meta, status='broken' with error_msg, UI surfaces existing "drift" badge.

**Non-functional**
- Reuse `cube-meta-version.ts` from Phase 2 for invalidation.
- Cron tick budget: max 30 tile refreshes per tick.
- Per-tile timeout 30s (faster than Phase 2's 60s since these are user-pinned queries, expected to be fast).

## Architecture

### Schema — migration 013-dashboard-tile-cache.sql

```sql
CREATE TABLE IF NOT EXISTS dashboard_tile_cache (
  tile_id           INTEGER PRIMARY KEY REFERENCES dashboard_tiles(id) ON DELETE CASCADE,
  rows_json         TEXT NOT NULL,
  rows_hash         TEXT NOT NULL,
  cube_meta_version TEXT NOT NULL,
  fetched_at        DATETIME NOT NULL DEFAULT (datetime('now')),
  expires_at        DATETIME NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('fresh','refreshing','broken')) DEFAULT 'fresh',
  error_msg         TEXT
);

CREATE INDEX IF NOT EXISTS idx_dashboard_tile_cache_expires ON dashboard_tile_cache(expires_at);

-- viewer tracking — drives "refresh only recently-viewed dashboards"
ALTER TABLE dashboards ADD COLUMN last_viewed_at DATETIME;
ALTER TABLE dashboards ADD COLUMN tile_ttl_seconds INTEGER NOT NULL DEFAULT 300;
```

### Service layout

```
server/src/services/dashboard-tile-cache-store.ts   -- upsert/read/invalidate
server/src/jobs/refresh-dashboard-tiles.ts          -- cron, mirrors refresh-liveops.ts
server/src/routes/dashboards.ts                     -- extend list/detail to include cache; add /refresh
```

### Refresh job flow

```
every 90s:
  recently_viewed = SELECT id FROM dashboards WHERE last_viewed_at > now - 7d
  for each dashboard in recently_viewed:
    for each tile whose cache row is stale or missing or status='broken':
      mark refreshing
      try cube-client.load(tile.query)
        upsert (hash-skip)
        status='fresh'
      catch:
        status='broken' + error_msg
```

### Frontend changes

- `src/pages/Dashboards/use-dashboard-detail.ts` — GET response already includes `tiles[]`. Extend the type to include `cache: { rows, fetched_at, status, error_msg }`. Drop the per-tile fetch in `tile.tsx`.
- `src/pages/Dashboards/tile.tsx` — read `cache.rows` directly; show "Refreshing…" overlay when `cache.status === 'refreshing'`; surface drift via existing badge.
- `src/pages/Dashboards/dashboard-detail.tsx` — on mount, fire-and-forget `POST /api/dashboards/:slug/view-ping` to update `last_viewed_at`.
- Tile-level "Refresh now" button (kebab menu) → `POST /api/dashboards/:slug/tiles/:id/refresh`.

## Related Code Files

- **Create**
  - `server/src/db/migrations/013-dashboard-tile-cache.sql`
  - `server/src/services/dashboard-tile-cache-store.ts`
  - `server/src/jobs/refresh-dashboard-tiles.ts`
  - Tests for cache store + cron job
- **Modify**
  - `server/src/routes/dashboards.ts` — extend list/detail responses; new endpoints (`/refresh`, `/view-ping`)
  - `server/src/services/dashboard-store.ts` — `markViewed`, `setTileTtl`
  - `server/src/jobs/cron-runner.ts` — register new job
  - `server/src/index.ts` — start job at boot
  - `src/pages/Dashboards/use-dashboard-detail.ts`
  - `src/pages/Dashboards/tile.tsx`
  - `src/pages/Dashboards/dashboard-detail.tsx`
  - `src/pages/Dashboards/tile-fetch-queue.ts` — becomes dead code; delete after switch verified
- **Reuse (no edit)**
  - `server/src/services/cube-meta-version.ts` (created in Phase 2)
  - `server/src/services/card-cache-store.ts` (pattern reference only)

## Implementation Steps

1. Migration 013 + ALTER TABLE for `dashboards.last_viewed_at` + `tile_ttl_seconds`.
2. `dashboard-tile-cache-store.ts` — upsert/read/invalidate (hash-skip writes).
3. Extend `dashboard-store.ts` with `markViewed`, `setTileTtl`, and `listRecentlyViewedDashboards`.
4. `refresh-dashboard-tiles.ts` cron — recently-viewed → stale tiles → refresh → log.
5. Routes: extend GET detail to embed cache rows; add `/refresh`, `/view-ping`, `/tiles/:id/refresh`.
6. Frontend: switch tile to consume cache; add refresh button; ping on dashboard view.
7. Auto-refresh on tile add/update — call `refresh-dashboard-tiles` for that specific tile inline.
8. Delete dead `tile-fetch-queue.ts` after manual verification (the throttler is now server-side cron budget).
9. Tests + regression run on dashboard test suite.

## Success Criteria

- [ ] Dashboard detail load issues 1 HTTP call and zero Cube `/load` from browser.
- [ ] Tile cache hit < 50ms; miss returns existing tile shell with "Refreshing…" overlay.
- [ ] `last_viewed_at` updates on dashboard open; cron skips dashboards idle > 7d.
- [ ] Tile-level "Refresh now" works; `fetched_at` advances; cron interval not affected.
- [ ] Schema-drift tile shows drift badge AND status='broken' in DB.
- [ ] All `src/pages/Dashboards` tests pass; `tile-fetch-queue.test.ts` removed cleanly.

## Risk Assessment

- **Risk:** users add a tile and don't see data for up to 90s (cron tick).
  **Mitigation:** auto-trigger refresh inline on tile create/update (step 7); cron is for ongoing freshness only.
- **Risk:** "recently viewed in last 7d" too narrow; analysts open dashboards seasonally.
  **Mitigation:** make 7d a knob (env var `DASHBOARD_REFRESH_HORIZON_DAYS`). User-pinned dashboards (future) could override.
- **Risk:** stale tiles after tile.query is edited (rows_hash mismatch with new query).
  **Mitigation:** invalidate cache row on `PATCH /tiles/:id` that changes `query_json`. Step 7 covers this.
- **Risk:** disagreement on TTL across stakeholders.
  **Mitigation:** per-dashboard `tile_ttl_seconds` knob exposed in UI (small input on dashboard settings).
