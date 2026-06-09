# Phase 02 — Publish/Share Backend

**Priority:** P1 · **Status:** pending · **Depends on:** 01

## Schema (`chat-service/src/db/migrate.ts`, idempotent ALTERs)
- `ALTER TABLE chat_sessions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';`
- `ALTER TABLE chat_sessions ADD COLUMN owner_label TEXT;`
- `ALTER TABLE chat_sessions ADD COLUMN shared_at INTEGER;`
- Index: `idx_sessions_shared ON chat_sessions(visibility, game_id, workspace, last_turn_at DESC)`.
- Update `schema.sql` base table + `ChatSessionRow` type in `types.ts`.

## chat-store (`chat-service/src/db/chat-store.ts`)
- `createSession`: persist `owner_label` (from upstream body), `visibility='private'`.
- `setSessionVisibility(db, id, visibility)`: sets visibility + `shared_at` (now when shared, NULL when private).
- `listSharedSessions(db, {gameId, workspace, limit, q})`: `visibility='shared' AND status='active'
  AND deleted_at IS NULL` across all owners, ordered by recency. Returns rows incl. owner_label.

## chat-service routes (`chat-service/src/api/sessions.ts`)
- GET `/sessions/:id` — allow when `session.owner_id === ownerId` **OR** `session.visibility==='shared'`.
  Add `readOnly: session.owner_id !== ownerId` to the response so FE can lock the composer.
- PATCH `/sessions/:id` (rename), DELETE, POST `/restore` — stay **owner-only** (unchanged 403).
- POST `/sessions/:id/share` and POST `/sessions/:id/unshare` — owner-only; set visibility.
- GET `/sessions/shared?game=&workspace=&q=` — list shared sessions (any owner). 401 if no X-Owner-Id.

## Gateway proxy (`server/src/routes/chat.ts`)
- New routes proxying to chat-service: `GET /api/chat/sessions/shared`,
  `POST /api/chat/sessions/:id/share`, `POST /api/chat/sessions/:id/unshare`.
- Register **`/sessions/shared` before `/sessions/:id`** so `:id` doesn't swallow `shared`.
- `/turn` body already gains `owner_label` from Phase 01.

## Success criteria
- Owner POST `/share` → session visibility `shared`; non-owner GET detail → 200 + `readOnly:true`.
- Non-owner POST `/share` on someone else's session → 403.
- Non-shared + non-owner GET detail → 403.

## Risks
- Route ordering (`shared` vs `:id`). Fastify matches static before param, but assert with a test.
- Existing `listSessions` stays owner-scoped (your shared chats still appear in your own list).
