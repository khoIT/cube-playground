---
phase: 6
title: "Cron worker + live mode + FE polling + status transitions"
status: pending
priority: P1
effort: "4d"
dependencies: [1, 5]
---

# Phase 6: Cron worker + live mode + FE polling + status transitions

## Overview

Ship the in-process cron worker that refreshes live segments 24/7. Wire FE polling on Detail view so cron updates surface without page reload. Implement status transitions (`ok` / `refreshing` / `broken`) and surface them in the Library + Detail UI.

## Requirements

**Functional**
- Backend cron tick every 60s (node-cron `* * * * *`).
- Per tick:
  - Select `is_live=1` segments where `now - uids_updated_at >= refresh_interval_sec` (or `uids_updated_at IS NULL`).
  - Mark `status='refreshing'`.
  - Call Cube `/load` with cached `cube_query_json` using server-bootstrap JWT.
  - Extract identity column values, dedupe, JSON-encode → `uids_json`; set `uids_updated_at=now`.
  - On success: `status='ok'`, `last_error=null`.
  - On Cube error: `status='broken'`, `last_error=<message>`, do not retry until next tick.
- Manual refresh: `POST /api/segments/:id/refresh` enqueues an immediate run (sync if cron not currently busy, else queued).
- FE polling hook `useSegmentLivePolling(segmentId)` calls `GET /api/segments/:id` every 30s while Detail view is mounted; stops on unmount.
- Detail header `Refresh now` button calls manual refresh + shows spinner until status returns `ok` or `broken`.
- Library row shows `LiveBadge` with next-refresh countdown (computed FE-side from `uids_updated_at + refresh_interval_sec`).

**Non-functional**
- Cron does not run more than one tick concurrently (use a process-level boolean lock).
- Refresh job has 60s timeout per segment to avoid hung Cube requests.
- All status writes go through a single `setSegmentStatus(id, status, lastError)` helper.

## Architecture

```
server/src/
  jobs/
    cron-runner.ts                (cron schedule + tick orchestration)
    refresh-segment.ts            (single-segment refresh logic)
    refresh-queue.ts              (in-memory queue for /refresh manual calls)
  services/
    segment-status.ts             (status transition helper)
  routes/
    segments.ts                   (extend /refresh to enqueue)

src/pages/Segments/detail/
  hooks/
    use-segment-live-polling.ts
  components/
    refresh-now-button.tsx
    broken-segment-banner.tsx
  status/
    status-pill.tsx               (shared: ok | refreshing | broken)
```

`cron-runner.ts` boots from `server/src/index.ts` when `NODE_ENV !== 'test'`.

## Related Code Files

**Create**
- `server/src/jobs/{cron-runner,refresh-segment,refresh-queue}.ts`
- `server/src/services/segment-status.ts`
- `server/test/refresh-segment.test.ts`
- `src/pages/Segments/detail/hooks/use-segment-live-polling.ts`
- `src/pages/Segments/detail/components/{refresh-now-button,broken-segment-banner}.tsx`
- `src/pages/Segments/status/status-pill.tsx`

**Modify**
- `server/src/index.ts` — start cron after DB init
- `server/src/routes/segments.ts` — extend `/refresh` endpoint
- `src/pages/Segments/detail/detail-view.tsx` — wire polling hook + broken banner
- `src/pages/Segments/detail/detail-header-actions.tsx` — Refresh now button
- `src/pages/Segments/library/library-segment-row.tsx` — status pill + countdown

## Implementation Steps

1. Implement `services/segment-status.ts` — single helper updates `status`, `last_error`, `uids_updated_at` atomically (one `UPDATE`).
2. Implement `jobs/refresh-segment.ts`:
   - Loads segment by id.
   - Sets `status='refreshing'`.
   - Calls `cube-client.load(segment.cube_query_json, { timeout: 60_000 })`.
   - Extracts `identity_dim` column from result rows; dedupes; JSON-stringifies.
   - Calls `setSegmentStatus(id, 'ok', null)` and writes `uids_json` + `uids_updated_at`.
   - On error: `setSegmentStatus(id, 'broken', err.message)`; do not throw past the queue.
3. Implement `jobs/refresh-queue.ts`:
   - Simple `Set<segmentId>` + a `processing: boolean` flag.
   - `enqueue(id)` adds to set; `drain()` runs one-at-a-time until empty.
4. Implement `jobs/cron-runner.ts`:
   - `cron.schedule('* * * * *', tick)`.
   - `tick()` queries due-for-refresh segments, enqueues each, calls `drain()`.
   - Guards against overlapping ticks via the queue's `processing` flag.
5. Boot cron from `server/src/index.ts` after DB init; skip in tests via env check.
6. Extend `POST /api/segments/:id/refresh`:
   - Enqueues the segment.
   - Returns `202` immediately with current status.
   - If queue is idle, drain begins immediately.
7. Add `refresh-segment.test.ts`:
   - Mock cube-client; happy path writes uids and sets `ok`.
   - Cube error sets `broken` + populates `last_error`.
   - Timeout produces `broken` + `timed out` message.
8. Implement `use-segment-live-polling.ts` (30s interval; clears on unmount; pauses if document.hidden).
9. Implement `status-pill.tsx` — shared component with three states + tooltip showing `last_error` for broken.
10. Implement `broken-segment-banner.tsx` — top-of-detail alert with `Edit predicate to fix` button → editor route.
11. Implement `refresh-now-button.tsx` — POSTs, optimistically sets status to `refreshing`, awaits next poll to reveal end state.
12. Wire `detail-view.tsx` to use the polling hook + render banner when `status === 'broken'`.
13. Wire `library-segment-row.tsx` to render the status pill + next-refresh countdown for live segments.

## Success Criteria

- [ ] Live segment with `refresh_interval_sec=300` refreshes within 5 minutes after `uids_updated_at` ages out.
- [ ] Manual `Refresh now` updates uids within 5 seconds against a warm Cube.
- [ ] Cube `/load` error mid-refresh leaves segment in `broken` state with `last_error` populated.
- [ ] Cron does not double-fire when two ticks coincide with long Cube responses (verified by sleep stub in test).
- [ ] FE polling stops when Detail unmounts; resumes on remount.
- [ ] `status='broken'` triggers banner in Detail + red pill in Library.
- [ ] `Edit predicate to fix` jumps to editor with current predicate pre-loaded.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Cron starts before DB migrations finish | Boot order: open DB → run migrations → start cron. Test on cold start. |
| Long-running Cube `/load` blocks all subsequent refreshes | 60s per-segment timeout; queue continues to next item on timeout. |
| `node-cron` skews on process load spikes | Acceptable in v1 (single-instance dev tool); add metric in v1.5. |
| Multi-instance deployment would double-fire cron | Documented single-instance assumption in `server/README.md`; advisory locks in v1.5. |
| FE polling waste when no live segments visible | Hook checks `segment.is_live` before scheduling; static segments skip polling entirely. |
| Manual refresh + cron race write concurrent | Queue serializes; status transition helper uses a single UPDATE so reads see consistent state. |
