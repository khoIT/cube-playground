# Phase 03 — Swap Size-History Serve Path onto the Rollup

**Priority:** P1. **Status:** not started. **Depends on:** Phase 02 (rollup sealing).
Repoint the segment-size sparkline + "vs last week" delta from SQLite `segment_refresh_log` onto the
`members_daily` rollup — the user-visible payoff of the whole plan.

## Current serve path (verified)
- Frontend: `src/pages/Segments/detail/hooks/use-segment-size-delta.ts` →
  `segmentsClient.refreshLog(segmentId, windowDays, 200)`.
- Backend: `server/src/routes/segments.ts` (~L783/L810) reads `segment_refresh_log` (SQLite) →
  rows of `{ts, uid_count, status}`. Sparse (one point per refresh), capped uid context.

## Target serve path
- New backend endpoint (e.g. `GET /segments/:id/size-history?days=N`) that queries the membership
  cube via the existing `cube-client.ts` (`/load`): `measures:[segment_membership_daily.members_exact]`
  (or `members` for trend), `timeDimensions:[{ dimension: snapshot_date, granularity: day, dateRange:[D-N, D] }]`,
  `filters:[{ member: segment_id, operator: equals, values:[id] }]`, JWT scoped to the segment's game.
  Returns one point per **calendar day** (full history, not refresh cadence), served from CubeStore.
- Keep response shape compatible with `RefreshLogRow[]` (or add a sibling type) so
  `useSegmentSizeDelta` changes minimally.

## Implementation steps
1. Backend: add the size-history-from-rollup handler; resolve the segment's game + mint the
   per-game Cube JWT (reuse the existing token path the writer/cards use).
2. Map rollup rows → the shape `useSegmentSizeDelta` consumes (newest→oldest, `{ts, uid_count}`).
3. Frontend: point `useSegmentSizeDelta` (or `segmentsClient.refreshLog`) at the new endpoint;
   **fallback to the SQLite refresh-log path on error** (cohort that hasn't snapshotted yet, or a
   manual segment with no membership rows) — surface "live/approx" only if needed.
4. Leave `segment_refresh_log` writing intact (it's the fallback + the snapshot heartbeat).

## Success criteria
- Sparkline shows **full daily** history (denser than today's refresh-cadence points) for a
  snapshotted predicate segment, served from CubeStore (sub-second, no cold `game_integration`).
- A never-snapshotted / manual segment still renders via the SQLite fallback (no blank/broken UI).
- "vs last week" delta matches a direct rollup query within rounding.
- Existing segment-detail tests pass; add a test for the rollup→RefreshLogRow mapping + fallback.

## Scope reminder (do NOT overclaim)
This phase speeds up **size/size-history only**. Event-metric cards (KPI/line/bar) keep their
card_cache(SQLite)+cold-`game_integration` path — membership can't serve event metrics. Don't
touch `use-segment-cube-query.ts` card flow here.

## Risks
- Latest `snapshot_date` lags "now" by up to a day (nightly job) — label the sparkline "as of last
  snapshot" so it doesn't read as real-time. The `uid_count` header stays live from refresh.
- Manual segments have no membership rows → MUST hit the fallback, not error.

## Next → Phase 04 (optional surfaces) or stop here — the perf goal is met.
