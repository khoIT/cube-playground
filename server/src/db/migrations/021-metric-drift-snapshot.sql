-- Metric drift snapshot — persists each game's unresolved registry refs so the
-- noisy detector log ("skipping N metric(s) with unresolved refs") becomes a
-- product surface (the Drift Center page).
--
-- Keyed by (workspace_id, game, source). This is what makes drift
-- workspace-independent: switching workspace shows that workspace's own
-- snapshot and never overwrites another's. The detector writes
-- workspace_id='local', source='detector'; the live page writes the active
-- workspace id, source='live'. Replace-semantics are per (workspace, game,
-- source) — a ref that resolves this run disappears from that scope.
--
-- v1.5 hook: a future `last_seen_at TEXT` / `freshness_date TEXT` column is
-- additive (nullable) — it needs no rename and no data migration.

CREATE TABLE IF NOT EXISTS metric_drift_snapshot (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT    NOT NULL,
  game          TEXT    NOT NULL,
  metric_id     TEXT    NOT NULL,
  ref           TEXT    NOT NULL,
  reason        TEXT    NOT NULL CHECK (reason IN ('unparseable','cube-missing','member-missing')),
  source        TEXT    NOT NULL CHECK (source IN ('detector','live')) DEFAULT 'detector',
  updated_at    TEXT    NOT NULL,
  UNIQUE (workspace_id, game, metric_id, ref, source)
);

CREATE INDEX IF NOT EXISTS metric_drift_snapshot_scope_idx
  ON metric_drift_snapshot (workspace_id, game, source);
