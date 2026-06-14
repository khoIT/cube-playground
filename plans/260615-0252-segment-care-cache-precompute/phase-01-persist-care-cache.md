# Phase 01 — Persist the care cache

## Overview
Priority: P0 (foundation for serve-stale + precompute). Status: not started.
Replace the in-memory route cache with a durable SQLite store that preserves the
last-good payload, mirroring `segment_card_cache` (migration 051).

## Context
- Route: `server/src/routes/segment-cs-care.ts` — in-memory `Map` at line 68,
  `CACHE_TTL_MS = 6h` (line 39), `__clearCsCareCache()` test hook (line 71).
- Payload type: `CsCarePayload` (line 51) — persist verbatim as JSON.
- Pattern to copy: `segment_card_cache` + `card-cache-store.ts` (last-good value
  preserved on failure; `last_attempt_at` stamped every attempt).

## Related code files
- CREATE `server/src/db/migrations/056_segment_care_cache.sql`
- CREATE `server/src/services/segment-care-cache-store.ts`
- MODIFY `server/src/routes/segment-cs-care.ts` (swap Map → store)

## Schema (migration 056)
Two tables: the durable cache (last-good payload) + a per-pass run log that powers
the status board (mirrors `preagg_run` / `segment_card_run`).
```sql
CREATE TABLE IF NOT EXISTS segment_care_cache (
  segment_id      TEXT PRIMARY KEY,
  game_id         TEXT NOT NULL,
  payload_json    TEXT,            -- last-good CsCarePayload; preserved on failure
  computed_at     TEXT,            -- when payload_json was last successfully built
  last_attempt_at TEXT,            -- stamped every attempt (success or fail)
  last_error      TEXT,            -- last failure message, cleared on success
  status          TEXT NOT NULL DEFAULT 'ok'  -- 'ok' | 'stale' | 'error'
);
CREATE INDEX IF NOT EXISTS idx_segment_care_cache_computed
  ON segment_care_cache(computed_at);

-- One row per precompute attempt (cron OR manual) — powers the status board.
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
```

## Store API (`segment-care-cache-store.ts`)
- `readCareCache(segmentId): { payload, computedAt, lastError, ageMs } | null`
- `writeCareCache(segmentId, gameId, payload)` — sets payload/computed_at,
  clears last_error, status='ok'.
- `markCareAttempt(segmentId, gameId, error?)` — stamps last_attempt_at; on error
  sets last_error + status='error' but LEAVES payload_json untouched (last-good).
- `__clearCareCache()` test hook (delete all rows).

## Route changes
- Replace `cache.get` freshness check with `readCareCache`; honor `CACHE_TTL_MS`
  as the "fresh enough, skip recompute" threshold.
- On successful compute → `writeCareCache`.
- Keep `__clearCsCareCache` name as a thin re-export of `__clearCareCache` so
  existing tests don't break.

## Todo
- [ ] Write migration 056; confirm runner picks it up (next after 055).
- [ ] Implement store with last-good preservation.
- [ ] Refactor route to use store; preserve TTL semantics.
- [ ] Keep existing route test green.

## Success criteria
- Restart-survival: a computed payload is returned after a server restart with no
  Trino call (verified by store unit test + route test with stubbed reader).
- Failure preserves last-good payload (store unit test).

## Risks
- Migration numbering race with concurrent sessions (056 already free — verified
  latest is 055). If taken, bump to next free integer.
