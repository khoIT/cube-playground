-- Per-item build stats parsed from worker logs ('Performing query completed'
-- CREATE TABLE lines): how long the sweep spent building this game × cube,
-- how many partitions it wrote, and which rollups they belonged to.
ALTER TABLE preagg_sweep_item ADD COLUMN build_ms INTEGER;
ALTER TABLE preagg_sweep_item ADD COLUMN partitions_built INTEGER;
-- JSON array of rollup names, e.g. '["dau_by_country_payer_daily_batch"]'
ALTER TABLE preagg_sweep_item ADD COLUMN rollups_built TEXT;
