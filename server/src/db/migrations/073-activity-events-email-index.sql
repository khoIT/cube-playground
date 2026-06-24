-- Email-keyed timeline scans for the admin per-user observability surface.
--
-- A person's events are keyed by `actor_sub` (the Keycloak sub), but that sub
-- is NOT stable across a user's lifetime: dev mode keys by email, and an IdP
-- realm/client change mints a fresh sub UUID. The single `user_access.kc_sub`
-- the admin lookup resolves to is written once and never updated, so events
-- under any other sub for the same person are unreachable by a sub-only read.
-- The per-user views recover them by also matching the denormalised
-- `actor_email` column; this index makes that branch index-backed, mirroring
-- idx_activity_events_actor_ts. Case-folded to tolerate mixed-case JWT emails.
--
-- Additive + forward-only (matches the runner). No down-migration.

CREATE INDEX IF NOT EXISTS idx_activity_events_email_ts
  ON activity_events (LOWER(actor_email), ts);
