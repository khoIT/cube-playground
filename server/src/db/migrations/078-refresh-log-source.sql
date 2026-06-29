-- Record WHAT triggered each refresh so the Monitor "Refresh history" table can
-- tell a scheduled run apart from a manual one (and a create/edit kick-off).
-- Pre-existing rows predate this column and carry no trigger info, so they
-- backfill to 'unknown' rather than a misleading 'manual'. Live inserts always
-- write an explicit source going forward.
ALTER TABLE segment_refresh_log ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
