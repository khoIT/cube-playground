# Phase 03 — Persisted card checklist + manual lakehouse snapshot

Status: pending · Priority: high · Source: user follow-up after phase-02 demo

User asks (verbatim): (1) "I still want to see what cards are green / stale error inside each
segment" — the expanded row of a settled segment shows only Recent passes; the per-card picture
exists only during a live pass (in-memory). (2) "is there a current cron job for lake house - we
need ability to manual snapshot it here too" — cron EXISTS (hourly tick, daily-guarded, gated by
SEGMENT_SNAPSHOT_ENABLED → 'job off on this gateway' chip); no manual trigger.

## Part A — persisted per-card checklist

- `server/src/services/segment-refresh-ops.ts`: `listSegmentCardStatuses(segmentId)` over
  segment_card_cache (cardId, status, error, fetchedAt, lastAttemptAt; ORDER BY card_id)
- `server/src/routes/segment-refresh-ops.ts`: `GET /api/segment-refresh/:id/cards`
- FE: `SegmentCardStatus` type; `useCardStatuses(id, enabled)` hook; new
  `src/pages/Admin/hub/segment-refresh-card-checklist.tsx` — 2-col grid, 3 tones:
  ok (success dot) / ok-with-breadcrumb = serving last-good (warning dot + suffix) /
  error (destructive dot). Rendered on expand when NO live pass is shown (live checklist
  already covers in-flight + just-finished); refetch on pass completion.
- Row placeholder ("No recorded passes yet") narrows to the truly-empty case.

## Part B — manual lakehouse snapshot

- `server/src/jobs/snapshot-segment-membership.ts`: export `isSnapshotRunning()`;
  `triggerManualSnapshot()` — bypasses isEnabled + alreadyRanToday (explicit human action;
  writers are idempotent DELETE→INSERT per date/segment), respects `running` guard,
  deletes today's heartbeat rows first so the re-run's tallies REPLACE (listSnapshotRuns
  aggregates per date — appending would double-count), fire-and-forget.
- `server/src/services/segment-snapshot-runs.ts`: payload gains `runningNow`.
- Route: `POST /api/segment-refresh/snapshot-runs/trigger` → 202 {started} / 409 ALREADY_RUNNING.
- `snapshot-runs-section.tsx`: "Snapshot now" button; poll payload ~5s while runningNow; chip.

## Accepted risk (review finding 1)

The manual trigger's in-flight guard is per-process; the lakehouse is shared. Two gateways
writing the same (date, game, segment) slice CONCURRENTLY would interleave DELETE→INSERT and
silently duplicate rows (idempotency holds serially only). Mitigated, not eliminated: the UI
confirms before re-snapshotting a date that already landed (the common overlap path). A true
cross-instance lock would need a Trino-side sentinel — out of scope; revisit if multiple
gateways ever enable the cron.

## Success

- Settled healthy segment expands to full card grid with tones + ages.
- Snapshot-now on :3000 (job off here) starts a run, table shows it, no double-counted dates.
- Tests: service fn, trigger guard (409 while running), route gating; FE checklist render.
