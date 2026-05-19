-- Track which /meta version a segment's cached cube_query_json was translated against.
-- Drift detection compares this against the live /meta hash to know when to rehydrate.
ALTER TABLE segments ADD COLUMN predicate_meta_version TEXT;
ALTER TABLE segment_analyses ADD COLUMN query_meta_version TEXT;
