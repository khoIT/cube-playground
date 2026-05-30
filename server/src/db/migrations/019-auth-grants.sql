-- Writable authorization store (DB-authoritative authz).
--
-- Keycloak (or brokered Microsoft/Entra) now handles AUTHENTICATION only.
-- AUTHORIZATION — role + workspace/game/feature grants — lives here, keyed by
-- lowercased email so an admin can pre-provision a user BEFORE their first
-- login. `kc_sub` is captured on first successful login for audit/reconcile,
-- never used as the grant key.
--
-- Default-deny: an authenticated user with no row (or status != 'active') is
-- unauthorized. The login flow auto-creates a 'pending' row so the user
-- surfaces in the admin queue.

CREATE TABLE IF NOT EXISTS user_access (
  email       TEXT PRIMARY KEY,                       -- lowercased, trimmed
  role        TEXT NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('viewer', 'editor', 'admin')),
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'disabled')),
  kc_sub      TEXT,                                   -- captured on first login
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_access_status ON user_access(status);
CREATE INDEX IF NOT EXISTS idx_user_access_kc_sub ON user_access(kc_sub);

-- Per-user workspace grants. Row presence = granted.
CREATE TABLE IF NOT EXISTS user_workspace_access (
  email        TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  PRIMARY KEY (email, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_uwa_email ON user_workspace_access(email);

-- Per-user game grants. Row presence = granted.
CREATE TABLE IF NOT EXISTS user_game_access (
  email   TEXT NOT NULL,
  game_id TEXT NOT NULL,
  PRIMARY KEY (email, game_id)
);

CREATE INDEX IF NOT EXISTS idx_uga_email ON user_game_access(email);

-- Feature flags. `scope='role'` rows are defaults for everyone with that role;
-- `scope='user'` rows override per-email. `subject` is the email (user scope)
-- or the role name (role scope). `enabled` is 0/1.
CREATE TABLE IF NOT EXISTS feature_flags (
  scope       TEXT NOT NULL CHECK (scope IN ('user', 'role')),
  subject     TEXT NOT NULL,                          -- email or role name
  feature_key TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (scope, subject, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_subject ON feature_flags(scope, subject);
