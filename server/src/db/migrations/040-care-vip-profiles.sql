-- Persisted VIP profile snapshot for the care action queue.
--
-- The queue used to enrich each VIP row with a LIVE Cube → Trino query on every
-- load (name / LTV / tier / churn), which made the dashboard slow (cold Trino
-- 3.5–15s). Instead the case sweep — which already queries Cube — now writes the
-- deciding profile fields here, so the queue reads them from SQLite with zero
-- live Cube calls. Freshness is the sweep cadence, which is the ledger's refresh.
--
-- Keyed per (workspace, game, uid): one row per VIP. Churn-pay days are derived
-- at read time from last_recharge_date so they don't age between sweeps.
--
-- Additive + forward-only (runner keys off PRAGMA user_version = file count).

CREATE TABLE IF NOT EXISTS care_vip_profiles (
  workspace_id            TEXT NOT NULL,
  game_id                 TEXT NOT NULL,
  uid                     TEXT NOT NULL,
  name                    TEXT,
  ltv_vnd                 REAL,
  tier                    TEXT,
  days_since_last_active  INTEGER,
  last_recharge_date      TEXT,
  refreshed_at            TEXT NOT NULL,
  PRIMARY KEY (workspace_id, game_id, uid)
);
