-- Pre-rendered card data per segment. Refresh worker writes; FE reads
-- via GET /api/segments/:id and renders cards synchronously on first paint.
CREATE TABLE IF NOT EXISTS segment_card_cache (
  segment_id   TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  card_id      TEXT NOT NULL,
  query_hash   TEXT NOT NULL,
  rows_json    TEXT NOT NULL,
  fetched_at   DATETIME NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (segment_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_card_cache_segment ON segment_card_cache(segment_id);
