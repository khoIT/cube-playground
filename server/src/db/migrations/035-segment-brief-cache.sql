-- AI segment brief cache: one LLM-written executive narrative per
-- (segment, viewer language), keyed by the segment's definition hash so a
-- predicate edit regenerates while a rename serves the cached row.
--
-- status='error' rows persist the failure (brief_json NULL) so the FE can show
-- a retryable error state instead of re-triggering the LLM on every open.

CREATE TABLE IF NOT EXISTS segment_brief_cache (
  segment_id       TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  lang             TEXT NOT NULL,
  definition_hash  TEXT NOT NULL,
  brief_json       TEXT,
  status           TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  error            TEXT,
  generated_at     DATETIME NOT NULL,
  PRIMARY KEY (segment_id, lang)
);
