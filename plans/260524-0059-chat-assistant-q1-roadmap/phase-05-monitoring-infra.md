# Phase 05 — Monitoring Infra (Track B Foundation)

## Context Links
- Brainstorm: §M1 Track B (front-loaded). Risk §"Monitoring infra slip".
- Locked decisions: Q1 (chat-service scheduler), Q5 (in-app only Q1), Q7 (chat-service DB).

## Overview
- **Priority:** P1 (M1) — UNBLOCKS M3-F13.
- **Status:** pending
- **Description:** Backend foundation IN CHAT-SERVICE for scheduled refreshes of saved monitored segments and in-app notifications. Audit log for who-saved-what-when. Scope: in-app notifications only Q1.

## Key Insights
- Scheduler lives in chat-service (decision Q1) — NOT reusing server's `cron-runner.ts`. Use `node-cron` or `setInterval(60s)` in chat-service process. Refresh callbacks HTTP-call main server's existing `POST /api/segments/:id/refresh` endpoint — do NOT replicate refresh logic in chat-service.
- All new tables in chat-service SQLite (decision Q7). Do NOT touch `segments.db`.
- In-app notifications only Q1 (decision Q5). Email/Slack deferred to Q2. Keep driver interface narrow.
- Audit log lives in chat-service `monitoring_audit` table — separate from existing `chat_audit` (different concern; cross-domain events).

## Requirements

### Functional
- Notification driver interface `{ send(notification): Promise<void> }` with `in-app` implementation, in chat-service.
- `notifications` table in chat-service DB: id, owner_id, kind, payload_json, read_at, created_at.
- `GET /api/chat/notifications` (list unread) + `POST /api/chat/notifications/:id/read` (chat-service owns; exposed via server proxy).
- In-app: bell icon in shell with unread badge (component exists per recent commit `b60fc25`).
- Audit log table `monitoring_audit` in chat-service DB: actor, action (`segment_pinned|refresh_succeeded|refresh_failed|notification_sent`), target_id, detail_json, at.
- Scheduler hook: phase-12 will register saved-segment refresh callback via scheduler's `register(name, cron, handler)` API.

### Non-functional
- Notification dispatch <500ms p95 from event emit.
- Audit writes never block primary action (fire-and-forget with error log).
- Single-instance assumption for chat-service scheduler (note in docs).

## Architecture
- **Driver:** `chat-service/src/services/notification-driver.ts` — interface + in-app implementation (`chat-service/src/services/in-app-notification-driver.ts`).
- **Persistence:** chat-service SQLite (same DB as `chat_sessions`/`chat_turns`).
- **Routes:** `chat-service/src/routes/notifications.ts` (exposed via server proxy at `/api/chat/notifications`).
- **Scheduler:** `chat-service/src/services/scheduler.ts` (new) — uses `node-cron`. Hosts handler registration API: `register(name, cron, handler)`. Phase-12 registers monitored-segment-refresh handler here.
- **Bell shell:** existing `NotificationBell` topbar component (commit `95e4aef`) — wires to `/api/chat/notifications` via server proxy.

### Schema (additions to chat-service DB)
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
scheduler tick (chat-service node-cron) ─► registered handlers (e.g. monitored-segment refresh in phase-12)
  ↘ handler calls HTTP POST main-server /api/segments/:id/refresh
  ↘ on result: monitoring_audit insert + notification-driver.send() ─► notifications table
UI bell ─► server proxy /api/chat/notifications ─► chat-service ─► render unread
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Chat-service SQLite host | `chat-service/src/db/chat-store.ts` | Add new tables in same DB |
| Main server refresh endpoint | `server/src/routes/segments.ts` `POST /api/segments/:id/refresh` | HTTP target for refresh handler |
| Refresh queue | `server/src/jobs/refresh-queue.ts` | Pattern reference (do not fork) |
| Topbar bell | (referenced commit `95e4aef`) `src/shell/header/notification-bell.tsx` (verify path) | Consumer of `GET /api/chat/notifications` |
| Audit table | `chat-service/src/db/schema.sql` `chat_audit` | Pattern reference (separate concern; do not merge) |

### Create
- `chat-service/src/services/notification-driver.ts`
- `chat-service/src/services/in-app-notification-driver.ts`
- `chat-service/src/services/scheduler.ts`
- `chat-service/src/db/monitoring-migrate.ts`
- `chat-service/src/routes/notifications.ts`
- `chat-service/src/routes/__tests__/notifications.test.ts`

### Modify
- `chat-service/src/index.ts` (start scheduler on boot, register migrate, mount routes).
- `server/src/routes/chat.ts` (add notification proxy passthrough — pattern matches existing chat proxy).
- Existing topbar bell component (wire data source to `/api/chat/notifications`).

### Delete
- None.

## Implementation Steps
1. Add `node-cron` to `chat-service/package.json` (recommended over raw `setInterval`).
2. Author migrations idempotently in chat-service `monitoring-migrate.ts`.
3. Implement driver interface + in-app driver in chat-service.
4. Build scheduler service with `register(name, cron, handler)` API; start on boot.
5. Build `GET /api/chat/notifications` (unread first, paged) + `POST /:id/read` routes.
6. Add server proxy passthrough in `server/src/routes/chat.ts` (forward `/api/chat/notifications/*` to chat-service).
7. Wire topbar bell to fetch via proxy.
8. Expose helper `emitMonitoringEvent(event)` callable from chat-service modules.
9. Tests: route returns unread; mark-read works; driver writes table; audit appended; scheduler ticks and invokes registered handlers.

## Todo List
- [ ] Add `node-cron` dependency to chat-service
- [ ] Migrate script (notifications + monitoring_audit) in chat-service DB
- [ ] `notification-driver.ts` interface (chat-service)
- [ ] `in-app-notification-driver.ts` (chat-service)
- [ ] `scheduler.ts` with `register(name, cron, handler)` API
- [ ] `/api/chat/notifications` GET + POST (chat-service routes)
- [ ] Server proxy passthrough in `server/src/routes/chat.ts`
- [ ] Topbar bell wiring
- [ ] `emitMonitoringEvent` helper (chat-service)
- [ ] Tests

## Success Criteria
- Saved-segment refresh in phase-12 produces a visible notification within 60s of due time.
- Audit row exists for every refresh event (assert via test).
- Topbar bell badge updates within 30s of new notification (poll or SSE — recommend poll for Q1).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Scheduler tick reliability | Low | High | Use battle-tested `node-cron`; add startup log + health-check endpoint `/health` reports scheduler status. |
| Notification flood (refresh storm) | Med | Med | Dedup key on `(target_id, kind, day)`; phase-12 honours. |
| Driver interface locked in early | Low | Med | Keep narrow `send(notification)`; payload JSON is escape hatch. |

## Security Considerations
- Notifications scoped by `owner_id`; route checks session user.
- Audit append-only; no UI for tampering.
- No PII in payload beyond segment names; document.

## Next Steps
- Blocks: phase-12 (saved monitored segments) — direct consumer.
- Independent of phase-01..04.
- Phase-05 + phase-12 + phase-11 share chat-service DB migration cadence — recommend single migrate driver entry-point in `chat-service/src/db/`.

## Rollback
Drop new tables; revert route registration + bell wiring. Stop scheduler. No server-side changes to revert.
