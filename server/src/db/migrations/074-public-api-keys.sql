-- Public segment-export API: service-to-service API keys + per-pull audit.
--
-- api_keys backs the documented /api/public/v1/* surface. Keys are minted by an
-- admin, shown in plaintext exactly once, and only the sha256 is stored — the
-- plaintext is never persisted or logged (prefix is a non-secret display crumb).
-- Scope is the authorization boundary: workspace is required; segment_ids_json /
-- game_ids_json NULL means "all within the workspace", a JSON array means an
-- explicit allowlist. role is fixed read-only ('export-reader') for v1.
--
-- public_pull_audit records every full-cohort pull (a PII surface — uids) so an
-- admin can trace who pulled which segment, when, how many rows, and via which
-- source path. Folded into this migration (rather than a follow-up) since the
-- surface ships together. Row is opened on stream start and finalized on close.

CREATE TABLE IF NOT EXISTS api_keys (
  id               TEXT PRIMARY KEY,
  -- Non-secret display crumb, e.g. 'sk_live_ab3d…' — safe to render + log.
  key_prefix       TEXT NOT NULL,
  -- sha256(plaintext key) as lowercase hex. Lookups hash the presented key and
  -- match here, so the plaintext is never compared directly.
  key_sha256       TEXT NOT NULL UNIQUE,
  label            TEXT NOT NULL,
  workspace        TEXT NOT NULL,
  -- JSON array of segment ids this key may read; NULL = all in the workspace.
  segment_ids_json TEXT,
  -- JSON array of game ids this key may read; NULL = all.
  game_ids_json    TEXT,
  role             TEXT NOT NULL DEFAULT 'export-reader',
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  revoked_at       TEXT,
  expires_at       TEXT,
  last_used_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys (workspace);

CREATE TABLE IF NOT EXISTS public_pull_audit (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id         TEXT NOT NULL,
  segment_id     TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  rows_streamed  INTEGER NOT NULL DEFAULT 0,
  -- 'table' (lakehouse daily partition) or 'live' (compiled predicate SELECT).
  source         TEXT,
  format         TEXT,
  -- 'streaming' | 'complete' | 'aborted' | 'error'
  status         TEXT NOT NULL DEFAULT 'streaming',
  client_ip      TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_pull_audit_key ON public_pull_audit (key_id);
CREATE INDEX IF NOT EXISTS idx_public_pull_audit_started ON public_pull_audit (started_at);
