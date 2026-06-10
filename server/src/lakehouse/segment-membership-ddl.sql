-- Lakehouse fact tables for segment membership snapshots.
-- Target: stag_iceberg.khoitn (Trino Iceberg catalog, writable, parallel to game_integration).
-- Statements are split on ';' and run individually by ensureLakehouseTables().
-- CREATE TABLE IF NOT EXISTS makes this idempotent.

-- Full membership snapshot: one row per member, per segment, per day.
-- Partitioned by (snapshot_date, game_id, segment_id) so a single cohort slice
-- prunes to one partition — the app targets 100s of segments per game and
-- point-by-segment reads dominate. Sorted by uid for compact per-partition files.
CREATE TABLE IF NOT EXISTS stag_iceberg.khoitn.segment_membership_daily (
  snapshot_date DATE,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  uid           VARCHAR
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  sorted_by    = ARRAY['uid'],
  format       = 'PARQUET'
);

-- Day-over-day change feed (entered/exited) derived from the daily snapshot.
-- Same partition grain so a single (day, game, segment) diff prunes cleanly.
CREATE TABLE IF NOT EXISTS stag_iceberg.khoitn.segment_membership_delta (
  snapshot_date DATE,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  uid           VARCHAR,
  change        VARCHAR
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  sorted_by    = ARRAY['uid'],
  format       = 'PARQUET'
);
