# Phase 01 — Soft-delete with 7-day retention + Restore

## Context Links
- `chat-service/src/db/chat-store.ts:79` (`deleteSession` — current hard-delete)
- `chat-service/src/api/sessions.ts:149` (DELETE /sessions/:id handler)
- `chat-service/src/db/snapshot-store.ts` (tombstone propagation)
- `chat-service/src/db/schema.sql:22` (`chat_turns` ON DELETE CASCADE — must NOT fire on soft-delete)
- `chat-service/src/services/scheduler.ts` (cron host for retention sweep)
- `chat-service/src/api/debug.ts:111-127` (debug session listing — must include deleted)

## Overview
- Priority: P1 (correctness — currently destructive)
- Status: completed
- Change DELETE behavior from hard-purge to recoverable soft-delete; chat UI hides deleted, `/dev/chat-audit` shows them with a Restore action; background sweep hard-purges entries older than 7d.

## Key Insights
- Tombstones are authoritative in the snapshot pipeline — must continue writing them at the **final** hard-purge step, NOT at the soft-delete step. Interim state must not leak across machines.
- FK cascade fires on DELETE FROM chat_sessions — soft-delete is an UPDATE so cascade is naturally skipped.
- `deleted_at` predicate must be added to every owner-facing read path; debug paths must explicitly NOT filter it.

## Requirements

Functional:
- DELETE /sessions/:id sets `chat_sessions.deleted_at = now` (no row removal).
- New POST /sessions/:id/restore clears `deleted_at` (owner-scoped 401/403/404).
- All chat-UI list/detail queries gain `AND deleted_at IS NULL`.
- /debug/sessions and /debug/sessions/:id include deleted rows, returning a `deletedAt: number|null` field per session.
- /dev/chat-audit UI shows a "Deleted" badge on deleted sessions; an inline Restore button calls the new endpoint.
- Retention sweep: every 1h via node-cron, hard-purge sessions where `deleted_at < now - 7d`. Writes tombstones at purge time.

Non-functional:
- Sweep idempotent and bounded — LIMIT 200 per tick to avoid long transactions.
- Soft-delete must keep DELETE /sessions/:id at < 50ms (single UPDATE).

## Architecture

```
DELETE /sessions/:id
   └─ chatStore.softDeleteSession(db, id)
         └─ UPDATE chat_sessions SET deleted_at = ? WHERE id = ?
         └─ writeChatSnapshot(db)   (now mirrors deleted_at)

POST /sessions/:id/restore
   └─ chatStore.restoreSession(db, id)
         └─ UPDATE chat_sessions SET deleted_at = NULL WHERE id = ?

Cron retention-sweep (every 1h):
   └─ chatStore.purgeSoftDeleted(db, olderThanMs)
         └─ for each row WHERE deleted_at < cutoff LIMIT 200:
              DELETE FROM chat_sessions WHERE id = ?   (triggers FK cascade)
              INSERT OR REPLACE INTO chat_tombstones (session_id, deleted_at) VALUES (?, ?)
         └─ writeChatSnapshot(db) once at end (single I/O, not per-row)
```

Snapshot extension: `snapshot-store.ts` Snapshot v3 includes `deleted_at` per
session. Hydrate path must restore deleted_at when present (read-through).

## Related Code Files

Modify:
- `chat-service/src/db/schema.sql` — comment about new column (column added via ALTER in migrate.ts)
- `chat-service/src/db/migrate.ts` — `addColumnIfMissing(db, 'ALTER TABLE chat_sessions ADD COLUMN deleted_at INTEGER;')`
- `chat-service/src/db/chat-store.ts` — replace `deleteSession`; add `softDeleteSession`, `restoreSession`, `purgeSoftDeleted`; thread `AND deleted_at IS NULL` into `listSessions`, `getSession` (when called from chat UI path)
- `chat-service/src/api/sessions.ts` — DELETE handler calls softDelete; new POST /sessions/:id/restore handler; GET handlers gain a filter parameter
- `chat-service/src/api/debug.ts` — include `deletedAt` in session DTOs; do NOT filter deleted_at
- `chat-service/src/db/observability-store.ts` — `listSessionsForDebug` returns `deleted_at` column
- `chat-service/src/db/snapshot-store.ts` — Snapshot v3: serialize `deleted_at`; hydrate restores it
- `chat-service/src/index.ts` — register retention-sweep cron job
- `src/pages/DevAudit/use-debug-api-types.ts` — add `deletedAt: number|null` to `DebugSession`
- `src/pages/DevAudit/session-list.tsx` — "Deleted" badge, sort/secondary-style deleted rows
- `src/pages/DevAudit/session-detail.tsx` — Restore button when session.deletedAt != null

Create:
- `chat-service/src/services/retention-sweep.ts` — exports `registerRetentionSweep(db)` (KISS: < 60 LOC)
- `chat-service/src/db/__tests__/soft-delete.test.ts` — unit tests for the three new chat-store fns
- `chat-service/src/api/__tests__/sessions-soft-delete.test.ts` — DELETE then GET behaviour, restore round-trip

## Implementation Steps

1. **Migration**: in `migrate.ts`, add `ALTER TABLE chat_sessions ADD COLUMN deleted_at INTEGER;` via `addColumnIfMissing` — verify pre-existing rows default to NULL (= not deleted).
2. **chat-store**: rename old `deleteSession` to `_hardDeleteSession` (private-ish; keep export for sweep + tests). Add `softDeleteSession(db, id)`, `restoreSession(db, id)`, `purgeSoftDeleted(db, cutoffMs)` returning count purged. Add `AND deleted_at IS NULL` to `listSessions`. `getSession` stays neutral (returns row regardless); chat-UI callers gain explicit nullability handling.
3. **Sessions API**: DELETE handler → softDelete; new POST /sessions/:id/restore handler. GET /sessions and GET /sessions/:id must reject deleted rows (404) for the chat-UI semantics. /sessions GET already only sees `status != 'archived'` — extend to filter `deleted_at IS NULL`.
4. **Debug API**: extend `listSessionsForDebug` SELECT to expose `deleted_at`; the FE DTO maps that to `deletedAt`. Add a new route `POST /debug/sessions/:id/restore` (or reuse the public one — locked: reuse public to KISS).
5. **Snapshot**: bump version field to 3; serialize `deleted_at`. Hydrate: when session id not present locally and snapshot has `deleted_at != null`, write the soft-deleted row.
6. **Sweep cron**: new `retention-sweep.ts`. Register via `scheduler.register('retention-sweep', '0 * * * *', handler)` at index.ts boot. Handler calls `purgeSoftDeleted(db, Date.now() - 7*24*3600*1000)` inside a single transaction; on first tick after boot, run an immediate catch-up sweep.
7. **FE**: extend `DebugSession` type; render "Deleted" badge in session-list and "Restore" button in session-detail header. Restore triggers a list refresh.
8. **Verify**: enumerate all callers of `listSessions`/`getSession` (grep for `chatStore.listSessions`, `chatStore.getSession`) — make sure none silently surface deleted rows to the chat UI.

## Todo List

- [x] Add `deleted_at` column via migrate.ts
- [x] Refactor chat-store.deleteSession → soft/hard/restore/purge family
- [x] Update listSessions query with deleted_at filter
- [x] DELETE /sessions/:id handler → softDelete
- [x] POST /sessions/:id/restore handler
- [x] Extend debug DTO with deletedAt
- [x] Snapshot v3 schema + hydrate round-trip
- [x] retention-sweep.ts + scheduler register in index.ts
- [x] FE Deleted badge in SessionList
- [x] FE Restore button in SessionDetail
- [x] Tests: soft-delete, restore, purge cutoff boundary, sweep idempotency
- [x] Verify chat UI does NOT show deleted sessions (manual + integration)

## Success Criteria

- DELETE /sessions/:id returns 204; session disappears from chat list immediately but appears in /dev/chat-audit with "Deleted" badge
- Restore button (or POST /sessions/:id/restore) makes the session reappear in chat list
- After 7d (or by manually advancing the sweep cutoff in a test), session is hard-deleted, FK cascades, and a tombstone is written
- Snapshot round-trip preserves `deleted_at` state across hydrate
- All existing chat-store/session-API tests still pass

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Forgot a query that surfaces deleted rows to chat UI | M | H | Grep enumeration step (8); add integration test for /sessions and /sessions/:id |
| Sweep runs concurrently with snapshot write | L | M | Both are sync better-sqlite3 — single-writer locks make this race impossible |
| Hard-purge during sweep tombstones a session a user just restored | L | M | Sweep filter is `deleted_at < cutoff` — restore sets deleted_at NULL, naturally excluded |
| Restore endpoint missing owner check | L | H | Reuse the X-Owner-Id 401/403 pattern from existing handlers; add test for cross-owner restore (403) |

## Security Considerations
- Restore endpoint must enforce X-Owner-Id ownership (403 cross-owner).
- Hard-purge sweep runs as the process — no per-row auth needed; sessions already passed the X-Owner-Id check at soft-delete time.
- No new attack surface introduced; behaviour is strictly less destructive.

## Next Steps
- Phase 06 (response cache) does NOT need this — independent.
- Once shipped, consider extending tombstones with a `reason` column (UX vs sweep) — out of scope for v2.

## Unresolved Questions
None.
