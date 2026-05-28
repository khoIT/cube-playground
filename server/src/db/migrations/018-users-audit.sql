-- Phase 6 — thin users audit/cache table.
--
-- NOT authoritative for roles or per-game access. Both are derived from the
-- Keycloak token on every request (groups + realm_access.roles). This table
-- exists so that:
--   1. `segments.owner` / `dashboards.owner` / etc. have a stable FK target
--      that survives KC username changes (id = KC `sub` claim).
--   2. We can show "created by Alice" on artifact UIs without re-hitting KC.
--   3. We have an audit trail of "who logged in when".
--
-- `role` is a snapshot of the role at last login — handy for the user list
-- but the request-time guard always reads from the live token, never here.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- KC `sub` claim (stable across renames)
  username      TEXT NOT NULL,             -- KC `preferred_username` at last login
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'viewer',
  first_login   TEXT NOT NULL,
  last_login    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
