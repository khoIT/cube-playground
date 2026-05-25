-- Anomaly records persisted by the detector job.
-- UNIQUE(game, metric, ts) makes upserts idempotent per anomalous data point.

CREATE TABLE IF NOT EXISTS anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  metric TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('low','med','high')),
  baseline REAL NOT NULL,
  observed REAL NOT NULL,
  ts TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','ack','snoozed')) DEFAULT 'open',
  snooze_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(game, metric, ts)
);

CREATE INDEX IF NOT EXISTS anomalies_game_status_idx ON anomalies(game, status);
