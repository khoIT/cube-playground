-- Refresh history per segment. Library renders 7-day sparkline from this table;
-- Detail Monitor tab renders 50-row history. Refresh-job writes one row per
-- successful refresh. Retention pruned to 90d by the refresh-job tail.
CREATE TABLE IF NOT EXISTS segment_refresh_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id  TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  ts          DATETIME NOT NULL DEFAULT (datetime('now')),
  uid_count   INTEGER NOT NULL,
  status      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_log_segment_ts
  ON segment_refresh_log(segment_id, ts DESC);
