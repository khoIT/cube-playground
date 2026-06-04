# Phase 01 — Identity Isolation (the bug fix)

**Priority:** P0 · **Status:** pending

## Goal
Chat ownership becomes server-authoritative: derived from the verified JWT, not a client header.

## Changes

### FE — attach app JWT to chat requests
Chat clients use raw `fetch` and send only `X-Owner-Id` (default `'dev'`), no `Authorization`.
Add the bearer (mirror `src/api/api-client.ts:94-96`).
- New helper `src/api/chat-auth-headers.ts`: `chatHeaders(extra?)` → merges `X-Owner-Id`,
  workspace, and `Authorization: Bearer <appToken>` when `readAppToken()` present.
- Apply in: `chat-sse-client.ts` (turn + replay), `chat-sessions-client.ts`,
  `chat-notifications-client.ts`, `chat-audit-client.ts`, `chat-session-focus-client.ts`,
  `chat-cancel-turn.ts`, `chat-user-prefs-client.ts`.

### Gateway — trust the principal over the client header
`server/src/routes/chat.ts` `resolveOwner()` — flip priority:
```
if (request.owner && request.owner !== 'anonymous') return request.owner; // verified sub
const h = request.headers['x-owner-id']; if (typeof h==='string' && h.trim()) return h.trim();
return null;
```
- Real auth: `request.owner = claims.sub` → wins. Client `X-Owner-Id` ignored (closes spoof hole).
- Tests/dev: `request.owner='anonymous'` (owner-header mw) → falls back to `X-Owner-Id` → green.
- Also forward the real owner as `owner_id` in the `/turn` body (already uses `owner`). Add
  `owner_label` (from `request.user?.username ?? request.user?.email ?? owner`) to turn body +
  forwarded headers for Phase 02 display.

## Success criteria
- As vyvhy, GET `/api/chat/sessions/<khoitn-session>` → 403 (not 200).
- Session list shows only the caller's own sessions.
- `server/test/chat-proxy.test.ts` still passes (x-owner-id path preserved).

## Risks
- If a chat client path is missed, that surface stays on `'dev'` → grep all `getOwnerId()` callers.
- SSE uses `fetch` (not EventSource) so custom headers are supported — verified.
