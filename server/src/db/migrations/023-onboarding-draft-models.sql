-- Onboarding draft-model staging buffer — the approval gate for the cube-model
-- onboarding agent. A generated draft Cube model lands here (status 'pending')
-- and nothing reaches cube-dev disk until a reviewer approves it.
--
-- Approval gate: generator ≠ approver (enforced in the route, not the store).
-- Columns support it — created_by is set on generation, approved_by stays NULL
-- until a (different) reviewer approves in prod; self-approve allowed only in dev.
--
-- UNIQUE(game, cube_name) makes re-generation idempotent (upsert). status is a
-- CHECK enum; (game, status) is indexed for the Datasets/triage list views.
-- Timestamps are ISO8601 TEXT, aligning with anomaly-state / drift / access stores.

CREATE TABLE IF NOT EXISTS onboarding_draft_models (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  game            TEXT    NOT NULL,
  connector_id    TEXT    NOT NULL DEFAULT 'game_integration',
  schema_name     TEXT    NOT NULL DEFAULT '',
  cube_name       TEXT    NOT NULL,
  draft_json      TEXT    NOT NULL,        -- the CubeModel object (JSON)
  draft_yaml      TEXT    NOT NULL,        -- serialized YAML projection
  profile_json    TEXT,                    -- raw TableProfile[] used for inference
  confidence_json TEXT,                    -- InferredSchema (roles + confidences)
  status          TEXT    NOT NULL CHECK (status IN ('pending','accepted','rejected','written')) DEFAULT 'pending',
  source          TEXT    NOT NULL CHECK (source IN ('cold','warm')) DEFAULT 'cold',
  created_by      TEXT,
  approved_by     TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE (game, cube_name)
);

CREATE INDEX IF NOT EXISTS onboarding_draft_models_game_status_idx
  ON onboarding_draft_models (game, status);

-- Append-only audit of every status transition (mirrors business_metric_audit).
-- Enforced append-only at the app layer (no UPDATE/DELETE codepath).
CREATE TABLE IF NOT EXISTS onboarding_draft_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id    INTEGER NOT NULL,
  action      TEXT    NOT NULL CHECK (action IN ('generate','accept','reject','write','regenerate')),
  from_status TEXT,
  to_status   TEXT,
  actor       TEXT,
  reason      TEXT,
  ts          TEXT    NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES onboarding_draft_models(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS onboarding_draft_audit_draft_ts_idx
  ON onboarding_draft_audit (draft_id, ts DESC);
