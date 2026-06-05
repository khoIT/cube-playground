-- Per-card outcome on the precomputed card cache. A failed/budget-skipped card
-- now persists an error row (status='error', rows_json='[]') instead of being
-- absent, so the FE can distinguish "couldn't refresh" from "never ran".
-- Additive columns with defaults — existing rows read back as healthy 'ok'.
ALTER TABLE segment_card_cache ADD COLUMN status TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE segment_card_cache ADD COLUMN error TEXT;
