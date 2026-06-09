-- Per-playbook counts for one sweep run — cohort size + opened/lapsed/already-open
-- deltas, plus the skip reason when a playbook didn't run (disabled, unavailable,
-- trigger-eval-pending, no-predicate, query-failed). One row per playbook per run.
--
-- This is the durable record the trend view reads (cohort size over time per
-- playbook) and the diff view reads for count deltas between two runs. Kept at
-- the longer retention horizon than membership (counts are cheap).
--
-- Additive + forward-only (runner keys off PRAGMA user_version = file count).

CREATE TABLE IF NOT EXISTS care_sweep_playbook_results (
  run_id        TEXT NOT NULL,
  playbook_id   TEXT NOT NULL,
  cohort_size   INTEGER NOT NULL DEFAULT 0,
  opened        INTEGER NOT NULL DEFAULT 0,
  lapsed        INTEGER NOT NULL DEFAULT 0,
  already_open  INTEGER NOT NULL DEFAULT 0,
  skipped       TEXT,
  PRIMARY KEY (run_id, playbook_id),
  FOREIGN KEY (run_id) REFERENCES care_sweep_runs (run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS care_sweep_playbook_results_trend_idx
  ON care_sweep_playbook_results (playbook_id, run_id);
