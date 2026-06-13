# Segment refresh run history — persisted card-pass records shipped

**Date**: 2026-06-13 01:10 GMT+7
**Severity**: Low
**Component**: segment refresh pipeline, /admin/segment-refreshes monitor
**Status**: Completed

## What Happened

Shipped persisted per-pass run history for segment card refreshes, born directly out of the night's AbortError incident debugging: while triaging "9/33 failing" we could not tell which refresh pass an error breadcrumb came from or how old it was — `fetched_at` dates the last-good VALUE (preserved across failed passes by design), `error` holds the newest failed ATTEMPT, and the live card-progress view is in-memory, latest-pass-only, lost on restart. User asked for a pre-agg-runs-style redesign; scoped it down to three additive pieces and cooked it in one session.

## The Brutal Truth

Clean run. The one real design fork — whether stamping `last_attempt_at` on every pass would churn the demo seed snapshot — dissolved on inspection: `snapshot-store.ts` selects explicit columns, so the new column is invisible to it; the hash-skip write path just needed a timestamp-only UPDATE instead of a full skip. The code-reviewer earned its keep: it found a genuinely subtle stale-attribution window (a pass that throws before the runner's `plan()` fires leaves the PREVIOUS pass in card-progress, and the fallback recorder would have frozen "33/33 ok" tallies into a failed run's row — the exact kind of lie this table exists to kill). Guard added (`progress.startedAt >= passStartedAt`), plus a test that fails without it.

## Technical Details

- **Migration 051**: `segment_card_run` (one row per card pass: started/finished/source/total/ok/failed/failing_cards_json/run_error) + `segment_card_cache.last_attempt_at`. Count-based runner: file just has to sort last.
- **Retention**: keep-5 per segment, pruned inline in `recordCardRun` (one bounded DELETE per pass) — deliberately NOT the time-based standalone-job pattern of refresh-log retention; count-based + low-volume makes inline correct.
- **Source threading**: `enqueueRefresh(id, source)` with a `Map` beside the pending `Set` (the Set drops ids before the drain awaits, so source must ride separately); cron passes `'cron'`, routes `'manual'` explicitly.
- **API**: `GET /api/segment-refresh/:id/runs` (admin-gated, newest-first ≤5). FE strip fetches expand-gated only, refetches when a live pass completes.
- **Verified live on :3000**: manual refresh of an 18-uid segment persisted `source=manual, 31/31 ok` and stamped `last_attempt_at` on all 31 card rows including unchanged-value skip-path ones.

## Lessons

- When a cache deliberately preserves stale timestamps (last-good), any error recorded next to it needs its OWN timestamp — otherwise the pairing reads as current and misleads incident triage (it misled us twice in one night).
- In-memory progress modules that "never clear" (endRun stamps, beginRun overwrites) are safe for live display but poisonous as a fallback data source — always check the run actually belongs to the caller's window before persisting from it.
- Tester + reviewer agents in parallel with a live end-to-end probe is a good closing pattern: the probe proved migration + endpoint + stamping on the real dev DB while the agents covered breadth.
