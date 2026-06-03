-- Append-only activity telemetry spine.
--
-- One row per user-meaningful action (a query ran, a segment was mutated, a
-- feature page was opened). Aggregation keys on `actor_sub` — the Keycloak sub
-- is always present (req.owner), whereas email is nullable and only resolvable
-- post-login via user_access.kc_sub. `actor_email` is a denormalised display
-- snapshot, never the join key.
--
-- detail_json carries ONLY member names (cubes/measures/dimensions) — never
-- filter values, predicate literals, or player UID lists (see activity-store
-- projectQueryShape). Bounded retention is enforced by a prune sweep.
--
-- Additive + forward-only (matches the runner). No down-migration.

CREATE TABLE IF NOT EXISTS activity_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_sub   TEXT    NOT NULL,
  actor_email TEXT,
  event_type  TEXT    NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  workspace   TEXT,
  game        TEXT,
  detail_json TEXT,
  ts          INTEGER NOT NULL
);

-- Per-user timeline scans (Phase 4 aggregation groups by sub over a window).
CREATE INDEX IF NOT EXISTS idx_activity_events_actor_ts
  ON activity_events (actor_sub, ts);

-- Per-event-type windows (e.g. "all query_run in the last 30d").
CREATE INDEX IF NOT EXISTS idx_activity_events_type_ts
  ON activity_events (event_type, ts);
