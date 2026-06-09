-- Sweep-run history for the VIP-care ledger — one row per sweep (manual button
-- or the scheduled auto-sweep). The current open-case queue (care_cases) only
-- holds the latest state; this records each pass so the console can show a
-- run timeline, trend cohort sizes over time, and diff two runs per playbook.
--
-- started_at/finished_at are ISO strings (matching the drift-run history); ISO
-- 8601 UTC sorts lexicographically so retention prune compares with a string
-- cutoff. status='partial' means at least one playbook's cohort query failed
-- (the fail-soft skip) but the sweep otherwise completed.
--
-- Additive + forward-only (runner keys off PRAGMA user_version = file count).

CREATE TABLE IF NOT EXISTS care_sweep_runs (
  run_id              TEXT NOT NULL PRIMARY KEY,
  game                TEXT NOT NULL,
  workspace_id        TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('manual','cron')) DEFAULT 'manual',
  status              TEXT NOT NULL CHECK (status IN ('ok','partial','error')) DEFAULT 'ok',
  started_at          TEXT NOT NULL,
  finished_at         TEXT NOT NULL,
  opened_total        INTEGER NOT NULL DEFAULT 0,
  lapsed_total        INTEGER NOT NULL DEFAULT 0,
  profiles_refreshed  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS care_sweep_runs_game_idx
  ON care_sweep_runs (game, workspace_id, started_at DESC);
