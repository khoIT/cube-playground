# Phase 01 — Server: run records + attempt stamp

Status: ✅ done (2026-06-13) · Priority: high

## Files

**Create**
- `server/src/db/migrations/051-segment-card-runs.sql` — `segment_card_run` table + index +
  `ALTER TABLE segment_card_cache ADD COLUMN last_attempt_at TEXT`
- `server/src/services/segment-card-run-store.ts` — `recordCardRun()` (insert + prune keep-5),
  `listCardRuns(segmentId, limit=5)`
- `server/test/segment-card-run-store.test.ts`

**Modify**
- `server/src/jobs/refresh-queue.ts` — `enqueueRefresh(id, source)`; `Map<string,source>` beside
  pending Set; drain passes source to `refreshSegment`
- `server/src/jobs/cron-runner.ts:100` — `enqueueRefresh(id, 'cron')`
- `server/src/routes/segments.ts:438,760,1017` — `enqueueRefresh(id, 'manual')`
- `server/src/jobs/refresh-segment.ts` — accept `source` param (default 'cron'); in preset block
  capture pass start/finish, build run record from `entries` (success) or card-progress tallies +
  `run_error` (catch), write via `recordCardRun` in the `finally` next to `endRun`
- `server/src/services/card-cache-store.ts` — stamp `last_attempt_at = now` in upsert; on the
  skip-write (unchanged) path run timestamp-only UPDATE instead of full skip
- `server/src/services/segment-refresh-ops.ts` — `ErroringCard.lastAttemptAt` from new column
- `server/src/routes/segment-refresh-ops.ts` — `GET /api/segment-refresh/:id/runs`
- Tests: extend `card-cache-store-preserve-last-good.test.ts` (stamp on unchanged + preserved
  paths), `segment-refresh-ops.test.ts` (lastAttemptAt passthrough), `refresh-segment.test.ts`
  (run row recorded after pass), `segment-refresh-ops-route.test.ts` (:id/runs)

## Constraints

- Migration runner applies by sorted-filename index vs `PRAGMA user_version` count — new file
  must sort last (`051-…` after `050-…`). Additive only.
- `recordCardRun` must never throw past the refresh (best-effort, same posture as refresh-log).
- Last-good preservation semantics in upsert unchanged — only the new timestamp is added.
- `source` column named `source` (matches `preagg_sweep.source`), not the SQL keyword `trigger`.

## Success

- `vitest run` green in `server/` for all touched suites; tsc clean.
