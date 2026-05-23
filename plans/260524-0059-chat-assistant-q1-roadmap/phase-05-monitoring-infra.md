# Phase 05 — Monitoring Infra (Track B Foundation)

## Context Links
- Brainstorm: §M1 Track B (front-loaded). Risk §"Monitoring infra slip".
- Existing scheduler: `server/src/jobs/cron-runner.ts` (tick-every-60s, segments).

## Overview
- **Priority:** P1 (M1) — UNBLOCKS M3-F13.
- **Status:** pending
- **Description:** Backend foundation for scheduled refreshes of saved monitored segments and in-app notifications. Audit log for "who saved what when". Scope: in-app notifications only for Q1 (email/Slack deferred).

## Key Insights
- Existing `cron-runner.ts` already ticks every 60s and processes due segments — REUSE, don't fork. (Resolves Q1 scheduler location toward `server/src/jobs/`.)
- Notification dispatch must be generic enough to add email/Slack in Q2 without re-architecting (driver interface).
- Audit log already partially exists in `chat_audit`; extend for cross-domain events or add `monitoring_audit` server-side.

## Requirements

### Functional
- Notification driver interface `{ send(notification): Promise<void> }` with `in-app` implementation.
- `notifications` table: id, owner_id, kind, payload_json, read_at, created_at.
- `GET /api/notifications` (list unread) + `POST /api/notifications/:id/read`.
- In-app: bell icon in shell with unread badge (component exists per recent commit `b60fc25`).
- Audit log table `monitoring_audit`: actor, action (`segment_pinned|refresh_succeeded|refresh_failed|notification_sent`), target_id, detail_json, at.
- Scheduler hook: phase-12 will register saved-segment refresh callback into existing cron tick.

### Non-functional
- Notification dispatch <500ms p95 from event emit.
- Audit writes never block primary action (fire-and-forget with error log).
- Single-instance assumption inherited from existing scheduler (note in docs).

## Architecture
- **Driver:** `server/src/services/notification-driver.ts` — interface + in-app implementation.
- **Persistence:** new tables in existing `server/data/segments.db` (or scoped file `notifications.db` — decide step 1).
- **Routes:** `server/src/routes/notifications.ts`.
- **Bell shell:** existing `NotificationBell` topbar component (commit `95e4aef`) — wire to `/api/notifications`.

### Schema (additions to existing server DB)
```
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_owner_unread
  ON notifications(owner_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS monitoring_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  detail_json TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitoring_audit_target_at
  ON monitoring_audit(target_id, at DESC);
```

### Data flow
```
cron tick (existing) ─► saved-segment refresh handler (phase-12) ─► result
                                                                 ├─► monitoring_audit insert
                                                                 └─► notification-driver.send() ─► notifications table
UI bell ─► GET /api/notifications ─► render unread list
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Cron tick | `server/src/jobs/cron-runner.ts` | Extension point — add saved-segment handler in phase-12 |
| Refresh queue | `server/src/jobs/refresh-queue.ts` | Pattern reference for new handler |
| Segments DB | `server/data/segments.db` | Host new tables |
| Topbar bell | (referenced commit `95e4aef`) `src/shell/header/notification-bell.tsx` (verify path) | Consumer of `GET /api/notifications` |
| Audit table | `chat-service/src/db/schema.sql` `chat_audit` | Pattern reference (separate concern; do not merge) |

### Create
- `server/src/services/notification-driver.ts`
- `server/src/services/in-app-notification-driver.ts`
- `server/src/db/notifications-migrate.ts`
- `server/src/routes/notifications.ts`
- `server/src/routes/__tests__/notifications.test.ts`

### Modify
- `server/src/index.ts` (register route + run migrate).
- Existing topbar bell component (wire data source).

### Delete
- None.

## Implementation Steps
1. Decide DB location: same `segments.db` for cohesion vs new file. Recommend: same DB, tables prefixed for separation. Confirm with user.
2. Author migrations idempotently.
3. Implement driver interface + in-app driver.
4. Build `GET /api/notifications` (unread first, paged) + `POST /:id/read`.
5. Wire topbar bell to fetch + render.
6. Expose helper `emitMonitoringEvent(event)` callable from anywhere in `server/`.
7. Tests: route returns unread; mark-read works; driver writes table; audit appended.

## Todo List
- [ ] DB location decision (Q1 resolution)
- [ ] Migrate script (notifications + monitoring_audit)
- [ ] `notification-driver.ts` interface
- [ ] `in-app-notification-driver.ts`
- [ ] `/api/notifications` GET + POST
- [ ] Topbar bell wiring
- [ ] `emitMonitoringEvent` helper
- [ ] Tests

## Success Criteria
- Saved-segment refresh in phase-12 produces a visible notification within 60s of due time.
- Audit row exists for every refresh event (assert via test).
- Topbar bell badge updates within 30s of new notification (poll or SSE — recommend poll for Q1).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Scheduler tick reliability | Low | High | Reuse proven `cron-runner.ts`; add startup log + health-check. |
| Notification flood (refresh storm) | Med | Med | Dedup key on `(target_id, kind, day)`; phase-12 honours. |
| Driver interface locked in early | Low | Med | Keep narrow `send(notification)`; payload JSON is escape hatch. |

## Security Considerations
- Notifications scoped by `owner_id`; route checks session user.
- Audit append-only; no UI for tampering.
- No PII in payload beyond segment names; document.

## Next Steps
- Blocks: phase-12 (saved monitored segments) — direct consumer.
- Independent of phase-01..04.

## Rollback
Drop new tables (no production data yet); revert route registration + bell wiring. Cron-runner unchanged.
