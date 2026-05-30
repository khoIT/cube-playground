-- Audit trail for access-management mutations (admin API).
--
-- Every role/status/grant change made through /api/admin/* appends a row here:
-- who did it (actor_email), what action, on whom (target_email), and a JSON
-- detail blob. Append-only; never updated or deleted by the app.

CREATE TABLE IF NOT EXISTS access_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,            -- e.g. 'create_user','set_role','set_games'
  target_email TEXT NOT NULL,
  detail_json  TEXT,                     -- arbitrary action payload as JSON
  ts           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_audit_target ON access_audit(target_email);
CREATE INDEX IF NOT EXISTS idx_access_audit_ts ON access_audit(ts);
