-- Phase 3: pre-warmed cache for dashboard tiles.
-- Mirrors the liveops cache pattern (012): cron-driven refresh, hash-skip writes,
-- meta-version bust on Cube schema change. Cascade-deletes with the tile row.
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

CREATE INDEX IF NOT EXISTS idx_dashboard_tile_cache_expires
  ON dashboard_tile_cache(expires_at);

-- Viewer tracking — drives "refresh only recently-viewed dashboards" + per-dashboard TTL.
ALTER TABLE dashboards ADD COLUMN last_viewed_at DATETIME;
ALTER TABLE dashboards ADD COLUMN tile_ttl_seconds INTEGER NOT NULL DEFAULT 300;
