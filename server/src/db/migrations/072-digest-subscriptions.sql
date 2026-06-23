-- Digest subscriptions: scheduled in-app digest delivery for an owner's selected
-- metrics on a daily/weekly cadence. The digest runner queries Cube for the
-- subscribed metrics + open anomalies + top deltas, composes a payload, and fires
-- an in-app notification via the chat-service bridge.
--
-- Idempotence guard: last_run_date (YYYY-MM-DD) ensures a double-tick within the
-- same calendar day can't double-fire for that subscription.

CREATE TABLE IF NOT EXISTS digest_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner         TEXT    NOT NULL,
  game          TEXT    NOT NULL,
  -- JSON array of metric ids the owner wants in their digest
  metrics_json  TEXT    NOT NULL,
  cadence       TEXT    NOT NULL CHECK(cadence IN ('daily', 'weekly')),
  channel       TEXT    NOT NULL DEFAULT 'in_app',
  -- Ms epoch: when the digest runner should next check this subscription.
  -- NULL = not yet scheduled (will be set on first save).
  next_run_at   INTEGER,
  -- ISO date (YYYY-MM-DD) of the last successful delivery — prevents double-fire
  -- within the same cadence window even if the server ticks twice.
  last_run_date TEXT,
  created_at    INTEGER NOT NULL
);

-- Runner scans for subscriptions whose next_run_at <= now().
CREATE INDEX IF NOT EXISTS idx_digest_subscriptions_next_run ON digest_subscriptions (next_run_at);
