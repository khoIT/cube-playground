-- Experiments — the persisted experiment + its frozen treatment/hold-out arms.
--
-- An experiment turns a segment (the cohort) into a measured comparison: a
-- deterministic uid-level split is FROZEN at assignment time, and the scorecard
-- later reads each arm's real post-assignment gross from the billing_detail cube.
-- The monitor board's lifecycle (draft → frozen → delivering → measuring →
-- readout) is backed by `status` + `assigned_at`.
--
-- Assignment is stored here in SQLite (not the lakehouse): a single-experiment
-- POC needs an immutable, queryable arm record, and SQLite is lower-risk than a
-- non-atomic Iceberg DELETE+INSERT on the demo path. The arms are frozen — once
-- assigned, the rows never change, so the readout stays valid weeks later.
--
-- PII-free: the assignment table holds only uid + arm; the registry holds params.

CREATE TABLE IF NOT EXISTS experiments (
  id             TEXT    NOT NULL PRIMARY KEY,
  game_id        TEXT    NOT NULL,
  workspace      TEXT    NOT NULL DEFAULT 'local',
  name           TEXT    NOT NULL,
  hypothesis     TEXT    NOT NULL DEFAULT '',
  -- The cohort source: the segment whose members are split into arms.
  segment_id     TEXT    NOT NULL,
  -- Lifecycle: draft (created) → running (assigned/frozen) → completed → archived.
  status         TEXT    NOT NULL DEFAULT 'draft',
  -- Treatment share, whole percent (e.g. 50 = 50/50 split).
  split_pct      INTEGER NOT NULL DEFAULT 50,
  -- What "did it work?" measures: 'gross_payment_rate' | 'sessions_per_week'.
  primary_metric TEXT    NOT NULL DEFAULT 'gross_payment_rate',
  -- Measurement window in days after assignment.
  window_days    INTEGER NOT NULL DEFAULT 14,
  -- Max cohort members assigned to arms (POC bound; the segment may be far larger).
  cohort_cap     INTEGER NOT NULL DEFAULT 20000,
  -- When the split was frozen (NULL while draft).
  assigned_at    TEXT    NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_experiments_game ON experiments (game_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments (status);

-- Frozen arms: who-was-in-which-arm at assignment time. Immutable once written.
CREATE TABLE IF NOT EXISTS experiment_assignment (
  experiment_id TEXT NOT NULL,
  uid           TEXT NOT NULL,
  -- 'treatment' | 'control' (control = the untouched hold-out).
  arm           TEXT NOT NULL,
  PRIMARY KEY (experiment_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_experiment_assignment_arm
  ON experiment_assignment (experiment_id, arm);
