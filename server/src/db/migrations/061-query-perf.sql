-- Live Cube query telemetry — latency, status, and pre-agg routing per /load.
--
-- Distinct from `activity_events` (the user-activity spine: auth audit, segment
-- ops, chat). Query latency is high-volume time-series with its own retention
-- (30d, shorter than the spine's 90d), its own indexes, and a sampling policy —
-- mixing it into the spine would pollute every spine read with a filter. This
-- table reuses the SAME write discipline (fire-and-forget, single autocommit
-- INSERT, swallow on failure) and the SAME `projectQueryShape` PII gate.
--
-- PII boundary: `query_shape` holds member NAMES only (cubes/measures/dimensions
-- via projectQueryShape) — never filter values, dateRange bounds, or UID lists.
-- `error_excerpt` is a truncated Cube/Trino error MESSAGE, never a query payload.

CREATE TABLE IF NOT EXISTS query_perf (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,                 -- epoch ms
  actor_sub     TEXT    NOT NULL,
  actor_email   TEXT,
  workspace     TEXT,
  game          TEXT,
  method        TEXT    NOT NULL,                 -- 'GET' | 'POST'
  status        INTEGER NOT NULL,                 -- 200 / 400 / 502 / 504 ...
  latency_ms    INTEGER NOT NULL,
  used_preaggs  TEXT,                             -- JSON string[] from /load body ('[]' for lambda)
  preagg_hit    INTEGER,                          -- tri-state, derived at read time: 1 hit / 0 miss / NULL unknown
  query_shape   TEXT,                             -- JSON {cubes,measures,dimensions} via projectQueryShape — NAMES ONLY
  error_excerpt TEXT                              -- first ~200 chars of upstream error MESSAGE for non-200 (no query values)
);

CREATE INDEX IF NOT EXISTS idx_query_perf_ts         ON query_perf (ts);
CREATE INDEX IF NOT EXISTS idx_query_perf_status     ON query_perf (status);
CREATE INDEX IF NOT EXISTS idx_query_perf_ws_game_ts ON query_perf (workspace, game, ts);
