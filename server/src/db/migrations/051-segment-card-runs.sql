-- Per-pass history for the segment card-runner + attempt stamping.
--
-- segment_card_run: one row per card pass (the ~30-KPI recompute tail of a
-- segment refresh). The live view (card-progress.ts) is in-memory and only
-- retains the latest pass, so once a pass ends there was no way to tell WHICH
-- run a card error came from or how old it is. This table persists a compact
-- summary per pass; the store keeps only the newest few rows per segment.
--
-- last_attempt_at on segment_card_cache: fetched_at deliberately preserves the
-- last-good VALUE's age (see card-cache-store.ts last-good preservation), so a
-- failing card's error breadcrumb had no timestamp of its own. last_attempt_at
-- is stamped on EVERY refresh attempt — success, failure, or unchanged value —
-- making the breadcrumb's age readable.

CREATE TABLE IF NOT EXISTS segment_card_run (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id         TEXT    NOT NULL,
  started_at         TEXT    NOT NULL,
  finished_at        TEXT,
  source             TEXT    NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual'
  total              INTEGER NOT NULL,
  ok                 INTEGER NOT NULL,
  failed             INTEGER NOT NULL,
  failing_cards_json TEXT,   -- JSON [{cardId, error}] frozen at run time
  run_error          TEXT    -- pass-level throw (cards may be partially settled)
);

CREATE INDEX IF NOT EXISTS idx_segment_card_run_seg
  ON segment_card_run(segment_id, started_at DESC);

ALTER TABLE segment_card_cache ADD COLUMN last_attempt_at TEXT;
