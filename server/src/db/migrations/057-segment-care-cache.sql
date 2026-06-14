-- Durable cache + per-pass run log for the segment Care tab.
--
-- The Care tab overlays CS-ticket history onto a segment's members via a heavy
-- cross-catalog Trino join (often tens of seconds on a cold warehouse). The
-- route's cache used to be an in-memory Map: lost on restart, and a transient
-- Trino throw returned a hard 502 with no fallback. These two tables make the
-- payload durable and observable.
--
-- segment_care_cache: one row per segment holding the last-good payload.
-- Mirrors segment_card_cache's last-good preservation — a failed recompute
-- stamps last_attempt_at + last_error + status but LEAVES payload_json intact,
-- so the route can serve stale-on-error instead of failing the whole tab.
-- computed_at dates the last SUCCESSFUL build (the data's real age);
-- last_attempt_at moves on every attempt (success or fail).
--
-- segment_care_run: one row per precompute attempt (nightly cron OR manual
-- "run now"). Powers the status board. Retention is count-based per segment,
-- inlined in the run store (mirrors segment_card_run).

CREATE TABLE IF NOT EXISTS segment_care_cache (
  segment_id      TEXT PRIMARY KEY,
  game_id         TEXT NOT NULL,
  payload_json    TEXT,            -- last-good CsCarePayload (JSON); preserved on failure
  computed_at     TEXT,            -- when payload_json was last successfully built
  last_attempt_at TEXT,            -- stamped on every attempt (success or fail)
  last_error      TEXT,            -- last failure message; cleared on success
  status          TEXT NOT NULL DEFAULT 'ok'  -- 'ok' | 'error'
);

CREATE INDEX IF NOT EXISTS idx_segment_care_cache_computed
  ON segment_care_cache(computed_at);

CREATE TABLE IF NOT EXISTS segment_care_run (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id   TEXT    NOT NULL,
  game_id      TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual'
  started_at   TEXT    NOT NULL,
  finished_at  TEXT,
  status       TEXT    NOT NULL,                 -- 'ok' | 'error'
  tickets      INTEGER,                          -- summary counters for the board
  contacted    INTEGER,
  elapsed_ms   INTEGER,
  run_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_segment_care_run_seg
  ON segment_care_run(segment_id, started_at DESC);
