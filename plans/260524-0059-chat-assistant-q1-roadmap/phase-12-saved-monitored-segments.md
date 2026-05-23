# Phase 12 — Saved Monitored Segments (F13)

## Context Links
- Brainstorm: §M3 F13 — uses M1-Track-B infra.
- Direct consumer of phase-05 (scheduler + notifications) and phase-06 (segment definition cites catalog id).
- Locked decisions: Q1 (chat-service scheduler), Q7 (chat-service DB), Q9 (new `monitored_segments` table; cross-DB foreign-ref).

## Overview
- **Priority:** P1 (M3)
- **Status:** pending
- **Description:** Pin a segment from chat → schedule daily refresh → view history. Notification on completion. User-stated end-goal of Q1. Storage lives in chat-service DB; refresh handler runs in chat-service scheduler (phase-05) and HTTP-calls main server's existing `/api/segments/:id/refresh` endpoint.

## Key Insights
- Storage: NEW `monitored_segments` table in chat-service DB (decision Q9). Holds `segment_id` as foreign-ref-by-id to main server's `segments.db` (cross-DB; no JOIN). NOT extending `segments` table.
- Refresh: chat-service scheduler tick (phase-05) → calls main server `POST /api/segments/:id/refresh` over HTTP. Do NOT replicate refresh logic — reuse server endpoint.
- Catalog-consistency rule: pinned segment MUST cite catalog ids (enforced via phase-06 plan output; server-side gate at pin time).
- Notification dispatch goes through phase-05 driver (in-app only).
- Auth on HTTP refresh call: `Authorization: Bearer ${MAIN_SERVER_SERVICE_TOKEN}` (decision C2). Main server validates via shared service-token middleware (defined in phase-05).
- Ref drift policy: refresher detects 404 from main-server refresh → sets `last_status='segment_deleted'` + emits final notification; subsequent ticks filter out this row (decision C3). No webhook needed.

## Requirements

### Functional
- "Pin / Save as monitored" action on any chat-emitted segment artifact.
- Stores in NEW `monitored_segments` table in chat-service DB.
- Daily refresh schedule (default 09:00 local; configurable per pin).
- Refresh history: count, last-N values, last-error — in `monitored_segment_runs` table in chat-service DB.
- UI: "Monitored" section under chat-history-rail or dedicated `/chat/monitored` page.
- Notification on refresh complete (via phase-05 driver).
- Edit / pause / unpin actions.

### Non-functional
- Refresh per segment <30s p95.
- Scheduler tick processes ≤100 segments per minute without lag.

## Architecture

### Storage (chat-service DB)
```
CREATE TABLE IF NOT EXISTS monitored_segments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,        -- foreign-ref-by-id to server segments.db; no FK
  schedule_cron TEXT NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitored_segments_owner_game
  ON monitored_segments(owner_id, game_id);
CREATE INDEX IF NOT EXISTS idx_monitored_segments_due
  ON monitored_segments(last_run_at);

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

### Services + routes
- **Service:** `chat-service/src/services/monitored-segment-refresher.ts`.
  - On 404 from `POST /api/segments/:id/refresh`: mark monitored row `last_status='segment_deleted'`, write `monitoring_audit` `action='monitor_orphaned'`, emit notification `kind='segment_deleted'`. Do NOT delete the `monitored_segments` row (preserves audit history).
  - Scheduler's `listDueMonitored()` query filters `WHERE last_status IS NULL OR last_status NOT IN ('segment_deleted')` so deleted rows are skipped on future ticks.
- **Scheduler hook:** register with phase-05's scheduler API (`register('monitored-segment-refresh', '* * * * *', handler)`).
- **Tool:** `chat-service/src/tools/pin-segment.ts` — agent or UI calls.
- **Routes (chat-service; exposed via server proxy):**
  - `POST /api/chat/segments/:id/monitor` — pin (with schedule)
  - `DELETE /api/chat/segments/:id/monitor` — unpin
  - `GET /api/chat/segments/:id/runs` — history
- **UI:**
  - `src/pages/Chat/components/pin-segment-button.tsx`
  - `src/pages/Chat/components/monitored-segments-list.tsx`
  - `src/pages/Chat/components/segment-run-history.tsx`

### Data flow
```
chat artifact "segment X" ─► user clicks "Pin" ─► POST /api/chat/segments/:id/monitor
  ↘ chat-service: pin-segment tool validates catalog citation
  ↘ chat-service DB: insert monitored_segments row
scheduler tick (chat-service, every 60s) ─► listDueMonitored() ─► refresher per id
  ↘ HTTP POST main-server /api/segments/:id/refresh with Authorization: Bearer ${MAIN_SERVER_SERVICE_TOKEN}
  ↘ 200: insert monitored_segment_runs row + update last_run_at + emit success notification
  ↘ 404: set last_status='segment_deleted' + emit one-time deletion notification + skip future ticks
UI: monitored list polls /api/chat/segments?monitored=1
UI: run history opens segment-run-history modal
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Chat-service scheduler (phase-05) | `chat-service/src/services/scheduler.ts` | Register monitored-segment refresh handler |
| Main server refresh endpoint | `server/src/routes/segments.ts` `POST /api/segments/:id/refresh` | HTTP target — chat-service calls this |
| Refresh queue (segments live) | `server/src/jobs/refresh-queue.ts` + `refresh-segment.ts` | Pattern reference; reuse on server side |
| Notification driver (phase-05) | `chat-service/src/services/notification-driver.ts` | Emit completion |
| Audit (phase-05) | `monitoring_audit` table (chat-service DB) | Log pin/refresh events |
| Segments deeplink | `src/pages/Segments/segments-page.tsx` | "Open in segments builder" link |

### Create
- `chat-service/src/db/monitored-segments-migrate.ts`
- `chat-service/src/services/monitored-segment-refresher.ts`
- `chat-service/src/routes/monitored-segments.ts` (POST/DELETE/GET runs)
- `chat-service/src/tools/pin-segment.ts`
- `src/pages/Chat/components/pin-segment-button.tsx`
- `src/pages/Chat/components/monitored-segments-list.tsx`
- `src/pages/Chat/components/segment-run-history.tsx`
- `chat-service/src/services/__tests__/monitored-segment-refresher.test.ts`
- `tests/e2e/pin-segment-flow.test.ts`

### Modify
- `chat-service/src/services/scheduler.ts` (register refresher handler at boot).
- `chat-service/src/tools/registry.ts`
- `server/src/routes/chat.ts` (server proxy passthrough for `/api/chat/segments/:id/{monitor,runs}` paths).
- `src/pages/Chat/components/query-artifact-card.tsx` (mount Pin button).
- `src/pages/Chat/components/chat-history-rail.tsx` (monitored section).

### Delete
- None.

## Implementation Steps
1. Migrate adds `monitored_segments` + `monitored_segment_runs` tables to chat-service DB.
2. Refresher service in chat-service: accepts segment id, HTTP-calls main server refresh endpoint, inserts run row, emits notification.
3. Register refresher with phase-05 scheduler at boot.
4. Routes (POST/DELETE/GET) in chat-service; server proxy passthrough in `server/src/routes/chat.ts`.
5. Pin-segment tool wrapper.
6. UI components (pin button, list, history) — unchanged paths.
7. Citation gate: refuse pin if segment artifact lacks catalog citation (server-side check in chat-service route).
8. E2E: chat → pin → wait 60s with sped clock → assert notification + run row.
9. Refresher: on 404 from main-server, set `last_status='segment_deleted'` and emit deletion notification once.

## Todo List
- [ ] Migrate (`monitored_segments` + `monitored_segment_runs` in chat-service DB)
- [ ] `monitored-segment-refresher.ts` (chat-service)
- [ ] Scheduler registration (uses phase-05 API)
- [ ] Routes (POST/DELETE/GET runs) in chat-service
- [ ] Server proxy passthrough
- [ ] `pin-segment` tool
- [ ] UI: pin button + list + history
- [ ] Citation gate (server-side in chat-service route)
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
| Scheduler miss after restart | Low | Med | Catch-up logic: on chat-service boot, scan `monitored_segments` for rows with `last_run_at < now - cadence`; enqueue. |
| Segment deleted in segments.db | Med | Med | Handled reactively (404 catch): refresher sets `last_status='segment_deleted'`, emits single deletion notification, ticks skip thereafter via `listDueMonitored` filter. |

## Security Considerations
- Pin / unpin requires session owner == segment owner; route enforces.
- Refresh runs via HTTP call to main server with session-bound creds; no client-supplied auth.
- Run errors logged but `error` column never returns raw stack to UI (truncated).

## Next Steps
- Blocked by: phase-05 (scheduler + notification + audit infra), phase-06 (segment definitions cite catalog).
- Blocks: phase-13 (recents rail surfaces saved segments).

## Rollback
- Drop monitor tables in chat-service DB (data loss; pre-prod only).
- OR set inactive flag (soft disable).
- Unregister scheduler handler + route + tool.
- No server-side changes to revert.
