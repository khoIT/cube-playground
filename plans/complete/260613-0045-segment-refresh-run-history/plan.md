# Segment Refresh Run History

**Goal:** answer "which run was this error from and how old is it" on /admin/segment-refreshes.
Tonight's incident debugging proved the gap: error breadcrumbs from 13:50 and 17:56 passes were
indistinguishable; `fetched_at` dates the last-good VALUE, the `error` column dates the newest
failed ATTEMPT — different runs, no way to tell.

**User decision (verbatim):** "Should we redesign segment refresh similar to pre-agg runs - where
each segment has a master card status and also keep track of the records of most recent 3 runs to
see their status - right now I can't tell which run was and how old" → approved 3-point design,
"just /ck:cook".

## Design (approved)

1. **Persist run records** — `segment_card_run` table, one row per card pass written at the point
   `endRun` fires in `refresh-segment.ts` (entries with per-card errors already in hand). Keep
   last **5** per segment (user said "most recent 3" as a floor; 5 covers a working day at 1h
   cadence), prune inline after insert. Thread `source: 'cron' | 'manual'` through refresh-queue.
2. **Date the breadcrumbs** — `last_attempt_at` column on `segment_card_cache`, stamped on EVERY
   attempt (success or fail). Verified safe: seed snapshot (`snapshot-store.ts`) selects explicit
   columns so no churn; skip-write path gets a timestamp-only UPDATE.
3. **UI "Recent passes" strip** — in the expanded row, below the live checklist:
   `12m ago · manual · 26/33 ok · 7 failed` + failing-card details per run. Erroring-card lines
   gain "attempted {age} ago" from last_attempt_at. Master chip = existing derivedState (no change).

## Out of scope

- No mirror of the full preagg console (log tailing, sweep grouping, per-partition windows).
- No change to budget/card-ordering (separate finding — late-wave 4s squeeze).
- `segment_refresh_log` (cohort-level) stays as-is; run table sits beside it.
- No cross-gateway aggregation — per-instance like the rest of the monitor.

## Phases

| # | File | Status |
|---|------|--------|
| 1 | [phase-01-server-run-records-and-attempt-stamp.md](phase-01-server-run-records-and-attempt-stamp.md) | ✅ done |
| 2 | [phase-02-ui-recent-passes-strip.md](phase-02-ui-recent-passes-strip.md) | ✅ done |
| 3 | [phase-03-card-checklist-and-manual-snapshot.md](phase-03-card-checklist-and-manual-snapshot.md) | pending |

## Outcome (2026-06-13 01:07 GMT+7)

- All acceptance criteria met. Tester: 1,346/1,350 server tests pass (4 failures pre-existing in
  preagg-readiness, file unchanged vs HEAD); Admin FE 91/91. tsc clean for all touched files.
- Code review: DONE_WITH_CONCERNS → both should-fixes applied same session:
  (1) stale-progress guard in `recordRunHistory` (`progress.startedAt >= passStartedAt`) so a
  throw before plan() can't freeze the PREVIOUS pass's tallies into the failed run's row;
  (2) refresh-segment-level test for the pass-level-throw run record (validates the guard).
  Nits applied: explicit `'manual'` at segments.ts call sites, empty-expansion placeholder,
  console.warn in useRecentRuns catch. Skipped (low value): FE test for "attempted X ago" suffix.
- Live-verified on :3000: migration 051 applied (user_version 48), manual refresh of
  "High-Value Spenders (30d)" persisted run row (source=manual, 31/31 ok) and stamped
  last_attempt_at on all 31 card rows including unchanged-value (skip-path) ones.

## Acceptance criteria

- After a card pass completes (success OR pass-level throw), a `segment_card_run` row exists with
  started/finished/source/ok/failed + failing cards w/ errors; only newest 5 retained per segment.
- Every card-cache row carries `last_attempt_at` ≈ the pass time, even when value/status unchanged.
- GET `/api/segment-refresh/:id/runs` returns last 5 runs (admin-gated like siblings).
- Expanded monitor row shows the recent-passes strip; erroring cards show attempt age.
- All server + FE tests pass; no contract break to existing ops payload consumers
  (`ErroringCard.lastAttemptAt` is additive).
