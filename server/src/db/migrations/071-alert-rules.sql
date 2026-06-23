-- Alert rules: threshold/condition rules that fire in-app notifications when a
-- metric breaches the configured comparator+threshold. Rules are owner-scoped —
-- each owner only sees and manages their own rules. The anomaly bridge matches
-- (game, metric) against enabled rules to find recipient(s).

CREATE TABLE IF NOT EXISTS alert_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner       TEXT    NOT NULL,
  game        TEXT    NOT NULL,
  metric      TEXT    NOT NULL,
  comparator  TEXT    NOT NULL CHECK(comparator IN ('<', '>', '<=', '>=', 'pct_drop', 'pct_rise')),
  threshold   REAL    NOT NULL,
  -- Optional ISO8601 window hint for rule engine (e.g. "24h", "7d"); NULL = latest value
  window      TEXT,
  channel     TEXT    NOT NULL DEFAULT 'in_app',
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- Fast lookup for the anomaly bridge and rule evaluation cron: find enabled rules for a game.
CREATE INDEX IF NOT EXISTS idx_alert_rules_game_enabled ON alert_rules (game, enabled);
