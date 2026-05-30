-- Data connectors — DB-backed warehouse connection profiles with secrets
-- encrypted at rest. Supersedes the config-seed-only posture: a connector can
-- now be provisioned from the product UI (real connect), not just seeded via
-- env / connectors.config.json. The config-seed path is kept as a read-only
-- bootstrap fallback, merged with these rows at read time.
--
-- Secrets (password / key material) live ONLY in secret_ciphertext (+ iv + tag),
-- AES-256-GCM, key from CONNECTOR_SECRET_KEY. They are never stored in
-- config_json and never returned to the browser (the public projection redacts).
--
-- source_type drives the driver + introspection dispatch (trino, postgres, …).
-- config_json holds the NON-SECRET connection coordinates (host/port/user/
-- catalog/ssl + any source-specific non-secret fields) so new source types add
-- fields without a schema change. Timestamps are ISO8601 TEXT (aligns with the
-- onboarding-draft / drift / access stores).

CREATE TABLE IF NOT EXISTS connectors (
  id                TEXT    PRIMARY KEY,
  workspace_id      TEXT    NOT NULL DEFAULT 'local',
  source_type       TEXT    NOT NULL DEFAULT 'trino',
  label             TEXT    NOT NULL,
  config_json       TEXT    NOT NULL,          -- non-secret coordinates (JSON)
  secret_ciphertext TEXT,                       -- AES-256-GCM ciphertext (base64)
  secret_iv         TEXT,                       -- 12-byte IV (base64)
  secret_tag        TEXT,                       -- GCM auth tag (base64)
  status            TEXT    NOT NULL CHECK (status IN ('active','disabled')) DEFAULT 'active',
  created_by        TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS connectors_workspace_idx
  ON connectors (workspace_id, status);

-- Append-only audit of every connector lifecycle event. Enforced append-only at
-- the app layer (no UPDATE/DELETE codepath). detail is a free-form JSON/text note
-- and MUST never contain secret material.
CREATE TABLE IF NOT EXISTS connector_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_id TEXT    NOT NULL,
  action       TEXT    NOT NULL CHECK (action IN ('create','update','disable','test')),
  actor        TEXT,
  detail       TEXT,
  ts           TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS connector_audit_connector_ts_idx
  ON connector_audit (connector_id, ts DESC);
