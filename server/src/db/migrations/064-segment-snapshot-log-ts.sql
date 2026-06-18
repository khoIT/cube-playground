-- Add snapshot_ts to the snapshot heartbeat log so the per-segment cadence guard
-- can check idempotently: a segment is skipped if a row exists for
-- (segment_id, snapshot_ts) — preventing double-writes within the same bucket
-- when multiple ticks fire before the cadence advances.
ALTER TABLE segment_snapshot_log ADD COLUMN snapshot_ts TEXT;

-- Index for the per-(segment, ts) guard lookup — called once per segment per tick.
CREATE INDEX IF NOT EXISTS idx_snapshot_log_seg_ts
  ON segment_snapshot_log(segment_id, snapshot_ts);
