-- Pre-aggregation sweep history tables.
--
-- Two tables:
--   preagg_sweep      — one row per collector pass (hourly sweep or probe snapshot)
--   preagg_sweep_item — one row per (game × cube) outcome within a sweep
--
-- started_at is the idempotency key: the collector upserts on it so a re-tail
-- or restart never duplicates a sweep row. ON DELETE CASCADE keeps items in
-- sync when old sweeps are pruned.

CREATE TABLE IF NOT EXISTS preagg_sweep (
  id               INTEGER PRIMARY KEY,
  started_at       TEXT    NOT NULL UNIQUE,
  ended_at         TEXT,
  duration_ms      INTEGER,
  source           TEXT    NOT NULL,   -- 'scheduled' | 'probe-snapshot'
  games_count      INTEGER,
  rollups_total    INTEGER,
  sealed_count     INTEGER,
  stale_count      INTEGER,
  failed_count     INTEGER,
  unbuilt_count    INTEGER,
  collector_status TEXT    -- 'online' | 'degraded' | 'disabled'
);

CREATE TABLE IF NOT EXISTS preagg_sweep_item (
  id             INTEGER PRIMARY KEY,
  sweep_id       INTEGER NOT NULL REFERENCES preagg_sweep(id) ON DELETE CASCADE,
  game           TEXT,
  cube           TEXT,
  rollup         TEXT,
  outcome        TEXT    NOT NULL,  -- 'sealed' | 'stale_serving' | 'failed' | 'unbuilt'
  serveable      INTEGER,           -- 0 | 1 (SQLite has no BOOLEAN)
  last_sealed_at TEXT,
  error_sig      TEXT,
  error_message  TEXT,
  observed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_preagg_sweep_started_at ON preagg_sweep(started_at);
CREATE INDEX IF NOT EXISTS idx_preagg_sweep_item_sweep_id ON preagg_sweep_item(sweep_id);
