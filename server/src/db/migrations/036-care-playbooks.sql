-- VIP-care playbook override/addition layer.
--
-- The 21 canonical playbooks ship as version-controlled seeds in
-- playbook-registry.ts. This table holds per-game CS authoring on top:
--   * base_id SET     → an override of a seed for one game (override wins per field).
--   * base_id NULL    → a brand-new CS-authored playbook.
-- Reads merge seed ⊕ overrides (override wins); seeds are never deleted, only
-- disabled or threshold-tuned via an override row.
--
-- Additive + forward-only (the runner keys off PRAGMA user_version = file count),
-- so no down-migration is needed.

CREATE TABLE IF NOT EXISTS care_playbooks (
  id TEXT PRIMARY KEY,                 -- override row id (uuid); NOT the seed id
  game_id TEXT NOT NULL,
  base_id TEXT,                        -- seed playbook id ("04") this overrides; NULL = net-new
  name TEXT,
  group_name TEXT,                     -- payment|ingame|churn|event
  priority TEXT,                       -- cao|tb|thap
  condition_json TEXT,                 -- serialized ThresholdRule
  watched_metric_json TEXT,
  action_json TEXT,
  data_requirements_json TEXT,         -- JSON array of logical member names
  enabled INTEGER NOT NULL DEFAULT 1,  -- 0 = disabled for this game
  owner TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One override per (game, seed). Net-new rows (base_id NULL) are unconstrained;
-- SQLite treats NULLs as distinct, so the partial-style uniqueness only binds
-- real seed overrides.
CREATE UNIQUE INDEX IF NOT EXISTS ux_care_playbook_override
  ON care_playbooks(game_id, base_id) WHERE base_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_care_playbooks_game ON care_playbooks(game_id);
