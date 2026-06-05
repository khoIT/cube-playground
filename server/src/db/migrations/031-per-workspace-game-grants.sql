-- Per-workspace game grants.
--
-- Game access used to be GLOBAL: a single user_game_access(email, game_id) list
-- applied identically to every workspace. But each Cube workspace exposes a
-- different set of games (a prefix workspace only surfaces its gamePrefixMap
-- keys), so a global grant can't express "in workspace A allow these games, in
-- workspace B allow those". This rebuilds the table with a workspace_id so a
-- grant is scoped to one workspace; the picker and the request gate enforce the
-- ACTIVE workspace's grants, fail-closed when a workspace has no grant rows.
--
-- Backfill preserves current access: every existing global (email, game_id) is
-- replicated across each workspace the user already holds in
-- user_workspace_access (cross join per email). A user with games but no
-- workspace grant yields zero rows here — correct under the fail-closed model;
-- the no-grants-anywhere case is still covered by the role/grant fallback in the
-- authorization layer.
--
-- No FK: game ids live in gds.config.json and workspace ids in the workspace
-- registry JSON — neither is a DB table.

CREATE TABLE user_game_access_new (
  email        TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  game_id      TEXT NOT NULL,
  PRIMARY KEY (email, workspace_id, game_id)
);

INSERT INTO user_game_access_new (email, workspace_id, game_id)
  SELECT g.email, w.workspace_id, g.game_id
    FROM user_game_access g
    JOIN user_workspace_access w ON w.email = g.email;

DROP TABLE user_game_access;

ALTER TABLE user_game_access_new RENAME TO user_game_access;

CREATE INDEX IF NOT EXISTS idx_uga_email_ws ON user_game_access(email, workspace_id);
