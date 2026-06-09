# Default Admin Identity + Admin View-All Chat Audit

User decisions (260607): (1) remove `'dev'` synth identity — local AUTH_DISABLED identity = first bootstrap admin
(default `khoitn@vng.com.vn`), sub renamed + data backfilled; (2) `/dev/chat-audit` admins see ALL users' sessions
(default scope), non-admins stay self-scoped.

## Phase 1 — dev identity rename + backfill

- `server/src/auth/dev-identity.ts` (new): `devAdminEmail()` = first `AUTH_BOOTSTRAP_ADMINS` entry, fallback
  `khoitn@vng.com.vn`; `devOwnerSub()` = that email (owner key in dev mode = email string — legible, stable; real
  KC UUIDs only exist in real-auth stacks).
- `authenticate.ts` `devUser()`: id/username/email from dev-identity (was hardcoded `'dev'`).
- `server/src/auth/dev-owner-backfill.ts` (new): boot-time, idempotent, **gated on AUTH_DISABLED** — rewrites
  `owner='dev'` → `devOwnerSub()` in `segments`, `segment_analyses`, `dashboards`, + 017 workspace-artifact
  tables. NOT a SQL migration (must never run in prod; prod 'dev' rows unreachable either way).
- chat-service: boot backfill gated by env `DEV_OWNER_BACKFILL_TO` (set in local `.env` only) — rewrites
  `chat_sessions.owner_id='dev'` after snapshot hydration. Prod/docker stacks: use existing
  `reassign-session-owner.ts` script with the real KC sub if ever needed.
- FE defaults in lockstep: `api-client.ts` `DEFAULT_OWNER` + `chat-owner-id.ts` fallback → `khoitn@vng.com.vn`.
- X-Owner override (multi-user simulation) unchanged; `synthEmail()`/`dev.invalid` domain unchanged.

## Phase 2 — admin view-all in /dev/chat-audit

- chat-service `debug.ts`: trust `X-Debug-Admin: 1` (set only by the server proxy from verified DB role):
  - `GET /debug/sessions?scope=all` + admin header → `listSessionsForDebug({allOwners:true})`.
  - `GET /debug/sessions/:id`, `/debug/turns/:turnId`, `/debug/turns/:turnId/raw`: owner guard OR admin header.
  - Mutations (restore, purge, annotations, bulk) stay strictly owner-scoped — cross-user access is READ-ONLY,
    mirroring the `admin-chat-audit.ts` authorization boundary.
- server `chat.ts` debug proxy: `proxyJson` gains optional extra headers; debug GET routes attach
  `X-Debug-Admin: 1` when `request.user.role === 'admin'`; `scope=all` from a non-admin → 403.
- FE: `useDebugSessions` gains scope param; `sessions-tab` shows All-users/Mine toggle for admins (default All);
  session rows show owner when scope=all (`DebugSession.owner_id` already in DTO).
- Search tab stays self-scoped for now (separate surface; extend later if needed).

## Status

- [x] Phase 1 server identity + backfill
- [x] Phase 1 chat-service backfill + FE defaults
- [x] Phase 2 chat-service admin scope
- [x] Phase 2 server proxy + FE toggle
- [x] Tests green (server 894, chat-service 1060, FE DevAudit/api/auth 274; 5 pre-existing Starters tab-count failures untouched)

## Unresolved questions

- `:11000` docker stack seeds owned by `'dev'`: invisible to real users by design; reassign manually via
  `reassign-session-owner.ts --to=<real-kc-sub>` if wanted.
- Segments seed rows owned by `'khoitn'` (not `'dev'`) left untouched — segment owner semantics are mid-flight
  in the segment-sharing plan; do not double-migrate.

## Post-implementation fix (same session)

Segment "uneditable" report on :3000 → root cause: browser localStorage held the retired `'dev'` owner, sent as
`X-Owner` which overrides the synth identity → `is_owner:false` hid edit controls. Fixed three ways:
- FE `getOwner()`/`getOwnerId()` migrate a stored `'dev'` → default + clear the key.
- Server AUTH_DISABLED path maps `X-Owner: dev` → synth identity (stale clients can't resurrect it).
- Backfill extended to the `'khoitn'` seed alias (LEGACY_OWNERS = dev, khoitn) — live DB now 11/11 segments
  under `khoitn@vng.com.vn`.
