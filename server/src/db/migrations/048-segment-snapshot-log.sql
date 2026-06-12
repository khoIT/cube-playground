-- Heartbeat for the lakehouse snapshot job. One row per (snapshot_date,
-- segment) per run, recording the outcome of landing that segment's full
-- membership into stag_iceberg.khoitn.segment_membership_daily. The full
-- cohort lives in Trino, not here — this table is purely observability so the
-- app can show "last snapshot landed N members at T" without round-tripping
-- the lakehouse.
--
-- Additive + forward-only (runner keys off PRAGMA user_version = file count).
CREATE TABLE IF NOT EXISTS segment_snapshot_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  segment_id    TEXT NOT NULL,
  game_id       TEXT,
  row_count     INTEGER,
  status        TEXT NOT NULL,        -- 'written' | 'skipped' | 'error'
  detail        TEXT,                 -- skip reason / error message
  ts            DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segment_snapshot_log_seg_ts
  ON segment_snapshot_log(segment_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_segment_snapshot_log_date
  ON segment_snapshot_log(snapshot_date);
