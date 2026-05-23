# Phase 12 — Saved Monitored Segments (F13)

## Context Links
- Brainstorm: §M3 F13 — uses M1-Track-B infra.
- Direct consumer of phase-05 (scheduler + notifications) and phase-06 (segment definition cites catalog id).

## Overview
- **Priority:** P1 (M3)
- **Status:** pending
- **Description:** Pin a segment from chat → schedule daily refresh → view history. Notification on completion. User-stated end-goal of Q1.

## Key Insights
- Segment definitions live in existing `segments.db` already. This phase adds: monitoring flag, schedule, refresh history, notifications.
- Catalog-consistency rule: pinned segment MUST cite catalog ids (enforced via phase-06 plan output).
- Cron tick (`cron-runner.ts`) already iterates due segments — extend, don't fork.
- Notification dispatch goes through phase-05 driver.

## Requirements

### Functional
- "Pin / Save as monitored" action on any chat-emitted segment artifact.
- Stores in existing `segments` table OR new `monitored_segments` link table. Decide step 1.
- Daily refresh schedule (default 09:00 local; configurable per pin).
- Refresh history: count, last-N values, last-error.
- UI: "Monitored" section under chat-history-rail or dedicated `/chat/monitored` page.
- Notification on refresh complete (via phase-05 driver).
- Edit / pause / unpin actions.

### Non-functional
- Refresh per segment <30s p95.
- Cron tick processes ≤100 segments per minute without lag.

## Architecture
- **Storage:** extend `segments` table with `monitored INTEGER NOT NULL DEFAULT 0`, `monitor_schedule_cron TEXT`, `monitor_last_run_at INTEGER`, `monitor_last_status TEXT`. (Note: brainstorm says existing infra has `refresh_cadence_min` — reuse this pattern.)
- **History table:**
  ```
  CREATE TABLE IF NOT EXISTS monitored_segment_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,        -- 'success' | 'error'
    row_count INTEGER,
    error TEXT,
    triggered_by TEXT            -- 'cron' | 'manual'
  );
  CREATE INDEX IF NOT EXISTS idx_runs_segment_at
    ON monitored_segment_runs(segment_id, started_at DESC);
  ```
- **Service:** `server/src/services/monitored-segment-refresher.ts`.
- **Cron hook:** extend `cron-runner.ts` to call refresher for monitored segments due.
- **Tool:** `chat-service/src/tools/pin-segment.ts` — agent or UI calls.
- **Routes:**
  - `POST /api/segments/:id/monitor` — pin (with schedule)
  - `DELETE /api/segments/:id/monitor` — unpin
  - `GET /api/segments/:id/runs` — history
- **UI:**
  - `src/pages/Chat/components/pin-segment-button.tsx`
  - `src/pages/Chat/components/monitored-segments-list.tsx`
  - `src/pages/Chat/components/segment-run-history.tsx`

### Data flow
```
chat artifact "segment X" ─► user clicks "Pin" ─► POST /api/segments/:id/monitor
  ↘ tool pin-segment ─► validate citation (catalog ref present)
  ↘ DB: set monitored=1 + schedule
cron tick (every 60s) ─► listDueMonitored() ─► refresher per id
  ↘ run cube preview ─► insert run row ─► update last_run_at
  ↘ emit notification via phase-05 driver
UI: monitored list polls /api/segments?monitored=1
UI: run history opens segment-run-history modal
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Segments table | `server/data/segments.db` + `server/src/routes/segments.ts` | Extend with monitor fields |
| Cron tick | `server/src/jobs/cron-runner.ts` | Add monitored handler |
| Refresh queue (segments live) | `server/src/jobs/refresh-queue.ts` + `refresh-segment.ts` | Pattern reference; potentially reuse for refresh execution |
| Notification driver (phase-05) | `server/src/services/notification-driver.ts` | Emit completion |
| Audit (phase-05) | `monitoring_audit` table | Log pin/refresh events |
| Segments deeplink | `src/pages/Segments/segments-page.tsx` | "Open in segments builder" link |

### Create
- `server/src/db/monitored-segments-migrate.ts`
- `server/src/services/monitored-segment-refresher.ts`
- `server/src/routes/monitored-segments.ts` (POST/DELETE/GET runs)
- `chat-service/src/tools/pin-segment.ts`
- `src/pages/Chat/components/pin-segment-button.tsx`
- `src/pages/Chat/components/monitored-segments-list.tsx`
- `src/pages/Chat/components/segment-run-history.tsx`
- `server/src/services/__tests__/monitored-segment-refresher.test.ts`
- `tests/e2e/pin-segment-flow.test.ts`

### Modify
- `server/src/jobs/cron-runner.ts` (add due-monitored handler)
- `server/src/routes/segments.ts` (filter by monitored param)
- `chat-service/src/tools/registry.ts`
- `src/pages/Chat/components/query-artifact-card.tsx` (mount Pin button)
- `src/pages/Chat/components/chat-history-rail.tsx` (monitored section)

### Delete
- None.

## Implementation Steps
1. Decide storage shape: extend `segments` table vs link table. Recommend extend (simpler; matches existing `refresh_cadence_min` pattern).
2. Migrate adds columns + history table.
3. Refresher service — accepts segment id, runs preview, inserts run row, emits notification.
4. Cron hook: in tick handler add `listDueMonitored()` parallel to existing `listDueSegments()`.
5. Routes + tool wrappers.
6. UI components.
7. Citation gate: refuse pin if segment artifact lacks catalog citation (server-side check).
8. E2E: chat → pin → wait 60s with sped clock → assert notification + run row.

## Todo List
- [ ] Storage decision
- [ ] Migrate (columns + runs table)
- [ ] `monitored-segment-refresher.ts`
- [ ] Cron hook extension
- [ ] Routes (POST/DELETE/GET runs)
- [ ] `pin-segment` tool
- [ ] UI: pin button + list + history
- [ ] Citation gate (server)
- [ ] E2E test
- [ ] Notification integration

## Success Criteria (from brainstorm)
- ≥3 saved monitored segments per user within first 4 weeks (M3 target).
- 100% of refreshes produce an audit row + notification.
- 0 pinned segments without catalog citation (gate test).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Refresh storm if many segments due same minute | Med | Med | Stagger schedules by hash(segmentId); cap concurrency in refresher. |
| Notification spam | Med | Med | Per-segment dedup key `(segmentId, day)`. |
| Pin without citation slips through | Med | High | Server-side gate; e2e asserts catalog_ref present in artifact. |
| Cron miss after restart | Low | Med | Catch-up logic: on boot, scan for `monitor_last_run_at < now - cadence`. |

## Security Considerations
- Pin / unpin requires session owner == segment owner; route enforces.
- Refresh runs server-side with stored owner credentials; no client-supplied auth.
- Run errors logged but `error` column never returns raw stack to UI (truncated).

## Next Steps
- Blocked by: phase-05 (notification + audit infra), phase-06 (segment definitions cite catalog).
- Blocks: phase-13 (recents rail surfaces saved segments).

## Rollback
- Drop monitor columns + runs table (data loss; pre-prod only).
- Or set `monitored=0` for all rows (safe, soft disable). Cron handler becomes no-op.
- Unregister route + tool.
