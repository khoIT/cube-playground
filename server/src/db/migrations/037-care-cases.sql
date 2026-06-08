-- VIP-care case ledger — the stateful primitive the read-only monitor lacks.
-- One row per (user × playbook × occurrence): opened by the case sweep via
-- membership-diff or per-member trigger eval, carrying the stats snapshot that
-- fired it and a status lifecycle (new → in_review → treated → resolved/dismissed).
--
-- Additive + forward-only (runner keys off PRAGMA user_version = file count).

CREATE TABLE IF NOT EXISTS care_cases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  playbook_id TEXT NOT NULL,            -- effective playbook id (seed "04" or override id)
  uid TEXT NOT NULL,
  source TEXT NOT NULL,                 -- 'membership' | 'trigger'
  opened_at TEXT NOT NULL,
  stats_snapshot_json TEXT,             -- deciding stats AT MATCH TIME
  status TEXT NOT NULL DEFAULT 'new',   -- new|in_review|treated|resolved|dismissed
  condition_lapsed INTEGER NOT NULL DEFAULT 0,  -- 1 = matched then exited before treatment
  assignee TEXT,
  treated_at TEXT,
  channel_used TEXT,
  action_taken TEXT,
  notes TEXT,
  kpi_target TEXT,
  kpi_eval_at TEXT,
  outcome TEXT,                         -- kpi_met|kpi_missed|na
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Idempotent open: at most one OPEN case per (game, playbook, uid). A re-sweep
-- while the user still matches must NOT create a duplicate; resolved/dismissed
-- rows are excluded so a later re-trigger can open a fresh occurrence.
CREATE UNIQUE INDEX IF NOT EXISTS ux_open_case
  ON care_cases(game_id, playbook_id, uid)
  WHERE status NOT IN ('resolved', 'dismissed');

CREATE INDEX IF NOT EXISTS ix_care_cases_game_playbook ON care_cases(game_id, playbook_id);
CREATE INDEX IF NOT EXISTS ix_care_cases_game_uid ON care_cases(game_id, uid);
CREATE INDEX IF NOT EXISTS ix_care_cases_status ON care_cases(status);
CREATE INDEX IF NOT EXISTS ix_care_cases_kpi_eval ON care_cases(kpi_eval_at) WHERE status = 'treated';
