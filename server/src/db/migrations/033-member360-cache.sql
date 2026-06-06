-- Member-360 nightly precompute cache: per (segment, uid, panel) Cube rows for
-- the ~150 tiered members of each eligible segment. The nightly runner writes
-- (skip-if-unchanged); the detail page serves cache-first with live fallback.
--
-- status: 'ok' (rows valid) | 'error' (load failed / budget skipped — error
-- column says why) so the FE can distinguish "couldn't refresh" from "never ran".
CREATE TABLE IF NOT EXISTS segment_member360_cache (
  segment_id   TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  uid          TEXT NOT NULL,
  panel_id     TEXT NOT NULL,
  query_hash   TEXT NOT NULL,
  rows_json    TEXT NOT NULL,
  fetched_at   DATETIME NOT NULL DEFAULT (datetime('now')),
  status       TEXT NOT NULL DEFAULT 'ok',
  error        TEXT,
  PRIMARY KEY (segment_id, uid, panel_id)
);

CREATE INDEX IF NOT EXISTS idx_member360_cache_segment_fetched
  ON segment_member360_cache(segment_id, fetched_at);

-- Last completed nightly precompute pass for the segment (NULL = never ran).
-- The scheduler re-qualifies a segment when this predates the current window.
ALTER TABLE segments ADD COLUMN member360_last_run_at TEXT;
