-- Game-Context foundation: introduce game_id as app-wide scope. All pre-existing
-- segments backfill to 'ptg' (sole tenant in practice before this migration).
ALTER TABLE segments ADD COLUMN game_id TEXT NOT NULL DEFAULT 'ptg';

CREATE INDEX IF NOT EXISTS idx_segments_game_owner ON segments(game_id, owner);
