-- Server-side result cache for liveops surfaces (KPI strip, cohort grid, funnel).
-- Mirrors the segment_card_cache pattern: cron-driven refresh, hash-skip writes,
-- meta-version bust on Cube schema change.
CREATE TABLE IF NOT EXISTS liveops_result_cache (
  resource          TEXT NOT NULL,           -- 'kpi_strip' | 'cohort_grid' | 'funnel_result'
  cache_key         TEXT NOT NULL,           -- canonical key per resource (game / game:window / game:funnelHash)
  game              TEXT NOT NULL,           -- denormalized for cron iteration + invalidation
  payload_json      TEXT NOT NULL,
  payload_hash      TEXT NOT NULL,           -- sha256(payload_json) prefix
  cube_meta_version TEXT NOT NULL,           -- bust on Cube schema change
  fetched_at        DATETIME NOT NULL DEFAULT (datetime('now')),
  expires_at        DATETIME NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('fresh','refreshing','broken')) DEFAULT 'fresh',
  error_msg         TEXT,
  PRIMARY KEY (resource, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_liveops_cache_expires ON liveops_result_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_liveops_cache_game    ON liveops_result_cache(game, resource);

CREATE TABLE IF NOT EXISTS liveops_refresh_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resource    TEXT NOT NULL,
  cache_key   TEXT NOT NULL,
  game        TEXT NOT NULL,
  ts          DATETIME NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER NOT NULL,
  status      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_liveops_refresh_log_ts ON liveops_refresh_log(ts DESC);
