-- Workspace-scoped artifacts: per-(owner, workspace) isolation so switching
-- workspaces shows clean artifact sets. Pre-existing rows backfill to 'local'
-- (the prior implicit workspace).

ALTER TABLE segments ADD COLUMN workspace TEXT NOT NULL DEFAULT 'local';
CREATE INDEX IF NOT EXISTS idx_segments_workspace_game_owner
  ON segments(workspace, game_id, owner);

ALTER TABLE dashboards ADD COLUMN workspace TEXT NOT NULL DEFAULT 'local';
CREATE INDEX IF NOT EXISTS idx_dashboards_workspace_game_owner
  ON dashboards(workspace, game, owner);

-- Per-owner user prefs (key/value). Holds active workspace selection and any
-- other small UI settings that should survive device changes.
CREATE TABLE IF NOT EXISTS user_prefs (
  owner TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner, key)
);

-- Cube aliases (display name + icon) replace the localStorage key
-- `gds-cube:cube-aliases`. Scoped per workspace because cube names differ
-- between workspaces (e.g. prod 'cfm_active_daily' vs local 'active_daily').
CREATE TABLE IF NOT EXISTS cube_aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT    NOT NULL,
  workspace  TEXT    NOT NULL,
  cube_name  TEXT    NOT NULL,
  alias      TEXT,
  icon       TEXT,
  updated_at TEXT    NOT NULL,
  UNIQUE(owner, workspace, cube_name)
);

CREATE INDEX IF NOT EXISTS idx_cube_aliases_owner_workspace
  ON cube_aliases(owner, workspace);
