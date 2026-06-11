-- Ranked member profiles, serialized at refresh time: top-N members by the
-- segment's rank measure, enriched with the preset's member columns (in-game
-- name, lifecycle dates, LTV). Serves the tokenless members pull API without
-- any per-request Cube query.
-- Down: ALTER TABLE segments DROP COLUMN member_profiles_json
ALTER TABLE segments ADD COLUMN member_profiles_json TEXT;
