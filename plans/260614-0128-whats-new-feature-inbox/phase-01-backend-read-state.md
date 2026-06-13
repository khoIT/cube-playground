# Phase 01 — Backend: per-user read-state table + API

## Overview
Priority: P0 (frontend unread badge depends on it). Status: pending.
Persist which announcement ids each user has read; expose list + mark endpoints.

## Files to create
- `server/src/db/migrations/052-announcement-reads.sql`
- `server/src/routes/announcements.ts`
- `server/test/announcements-route.test.ts`

## Files to modify
- `server/src/index.ts` — `import announcementsRoutes` + `await app.register(announcementsRoutes)`.

## Schema (`052-announcement-reads.sql`)
```sql
CREATE TABLE IF NOT EXISTS announcement_reads (
  owner_id        TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  read_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, announcement_id)
);
```
Broadcast model: no row per announcement up front — a row appears only when a user reads one.
Unread is computed in the client (bundled ids − readIds), so the server stays content-agnostic.

## API (`announcements.ts`)
- `GET  /api/announcements/reads` → `{ readIds: string[] }` for the current owner.
- `POST /api/announcements/reads` body `{ ids: string[] }` → upsert read rows (INSERT OR IGNORE),
  return `{ readIds: string[] }`. "Mark all read" = client sends every bundled id.
- Owner identity: reuse the accessor existing owner-scoped routes use (verify in impl —
  `request.user` / workspace header). 401 if unidentified, mirroring current routes.
- Ids are opaque strings; cap `ids` length (e.g. 500) to bound a malicious payload.

## Success criteria
- Migration applies idempotently; table present.
- GET returns only the caller's ids; POST is idempotent; cross-owner isolation holds.
- Route registered; server boots.

## Tests
- list empty → `[]`; mark then list → contains ids; mark twice → no dup error;
  two owners isolated. Mirror `server/test/segment-snapshot-runs.test.ts` harness (tmp DB_PATH).
