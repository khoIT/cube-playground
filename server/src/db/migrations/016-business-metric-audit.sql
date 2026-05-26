-- Phase 08 — Business-metric audit trail.
-- Append-only log of every mutation (create / update / trust_change / delete)
-- so we can answer "who changed this and why" without mining YAML git history.
--
-- Append-only is enforced at the app layer (no UPDATE / DELETE codepath); the
-- table itself is a plain SQLite table.

CREATE TABLE IF NOT EXISTS business_metric_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  metric_id       TEXT    NOT NULL,
  action          TEXT    NOT NULL CHECK (action IN ('create','update','trust_change','delete')),
  old_value_json  TEXT,
  new_value_json  TEXT,
  actor_kind      TEXT    NOT NULL CHECK (actor_kind IN ('user','agent','system')),
  actor_id        TEXT,
  reason          TEXT,
  request_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_business_metric_audit_metric_ts
  ON business_metric_audit (metric_id, ts DESC);
