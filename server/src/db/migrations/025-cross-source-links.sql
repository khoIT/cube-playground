-- Cross-source links — ADVISORY relationships between cubes on different
-- connectors / dataSources (e.g. ballistar Trino facts × AppsFlyer-in-Postgres
-- × ClickHouse events). Cube has NO live SQL join across dataSources, so these
-- are modeling intent + documentation + a path-forward note — never compiled
-- into an executable Cube YAML. The link carries the conceptual key pair, a
-- relationship, and a free-text rationale; capability (executable? rollupJoin-
-- eligible?) is derived at read time from the source-type registry, not stored.
--
-- Secret-free by construction (connector ids only). Workspace-scoped. Timestamps
-- are ISO8601 TEXT, matching the connector / onboarding-draft stores.

CREATE TABLE IF NOT EXISTS cross_source_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    TEXT    NOT NULL DEFAULT 'local',
  left_cube       TEXT    NOT NULL,
  left_connector  TEXT    NOT NULL,
  right_cube      TEXT    NOT NULL,
  right_connector TEXT    NOT NULL,
  key_json        TEXT    NOT NULL,          -- { fromColumn, toColumn } (JSON)
  relationship    TEXT    NOT NULL,
  rationale       TEXT,
  status          TEXT    NOT NULL CHECK (status IN ('active','disabled')) DEFAULT 'active',
  created_by      TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS cross_source_links_workspace_idx
  ON cross_source_links (workspace_id, status);
