-- Metric drift run history — one row per drift-reconciliation pass per game, so
-- the Drift Center "Detector runs" tab can show a schedule + last-N runs with
-- deltas, instead of only the current snapshot (metric_drift_snapshot keeps just
-- the latest state, replace-per-scope).
--
-- The scheduled detector (workspace_id='local' model) and the on-demand "Run
-- now" trigger both append a row here. `started_at` is the run anchor; it also
-- lets next-run be derived (last started_at + interval) so the estimate survives
-- a server restart (the in-memory lastRunAt does not).
--
-- Counts are denormalized for cheap reads: total_unresolved + the per-reason
-- split + new/resolved deltas vs the previous run's set. status records whether
-- the pass actually reconciled ('ok') or bailed ('skipped' = no Cube token,
-- 'error' = /meta failed).

CREATE TABLE IF NOT EXISTS metric_drift_run (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  game              TEXT    NOT NULL,
  source            TEXT    NOT NULL CHECK (source IN ('detector','manual')) DEFAULT 'detector',
  status            TEXT    NOT NULL CHECK (status IN ('ok','skipped','error')) DEFAULT 'ok',
  started_at        TEXT    NOT NULL,
  finished_at       TEXT    NOT NULL,
  total_unresolved  INTEGER NOT NULL DEFAULT 0,
  root_cause_count  INTEGER NOT NULL DEFAULT 0,
  new_count         INTEGER NOT NULL DEFAULT 0,
  resolved_count    INTEGER NOT NULL DEFAULT 0,
  cube_missing      INTEGER NOT NULL DEFAULT 0,
  member_missing    INTEGER NOT NULL DEFAULT 0,
  unparseable       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS metric_drift_run_game_idx
  ON metric_drift_run (game, started_at DESC);
