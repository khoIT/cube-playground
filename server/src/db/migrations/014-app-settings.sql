-- Phase 6: simple key-value app_settings table.
-- Values are JSON strings so any shape (numbers, objects) can be stored without
-- per-key column churn. Defaults are seeded with INSERT OR IGNORE so the table
-- is preserved across re-migrations.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                -- JSON
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('liveops.kpi_refresh_seconds',      '45'),
  ('liveops.cache_ttl_seconds',        '{"kpi_strip":300,"cohort_grid":300,"funnel_result":300}'),
  ('liveops.anomaly_detector_enabled', 'true'),
  ('liveops.anomaly_thresholds',       '{"low":2,"med":3,"high":4}'),
  ('dashboards.tile_ttl_seconds',      '300'),
  ('dashboards.refresh_horizon_days',  '7'),
  ('dashboards.refresh_concurrency',   '30');
