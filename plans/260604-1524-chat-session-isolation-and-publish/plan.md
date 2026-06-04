# Chat Session Isolation + Publish-to-Team

## Problem
On `:11000` (real Keycloak auth) every user sees/opens every chat session. Root cause: chat
ownership is derived from a client-supplied `X-Owner-Id` header that is never personalized
(default `'dev'`) and chat FE requests never carry the app JWT — so the gateway can't see the
real user and the proxy trusts the spoofable client header. All chats collapse to owner `'dev'`.

Evidence: `src/api/chat-owner-id.ts:20` (default `'dev'`, never set on login) · chat clients send
no `Authorization` (`src/api/chat-sse-client.ts:371,460`) · `server/src/routes/chat.ts:103-114`
prefers client `X-Owner-Id` over verified `request.owner` · `authenticate.ts:135` sets
`request.owner = claims.sub` in real auth.

## Scope (user-confirmed)
1. **Isolate** chat sessions per authenticated user (server-authoritative identity).
2. **Publish/share**: owner can mark a chat `shared`; other team members get read-only view.
3. **Reassign** existing `'dev'`-owned chats to a real user (one-off migration script).

## Locked decisions
- `owner_id` = Keycloak `sub` (== `request.owner`), verified by `authenticate.ts:135`.
- New columns on `chat_sessions`: `visibility TEXT NOT NULL DEFAULT 'private'` (`private`|`shared`),
  `owner_label TEXT` (display name for "shared by", from JWT username/email).
- Shared session: **any authenticated user can READ**; **only owner** can rename/delete/share/unshare.
- Reassign sub is supplied at runtime (script arg) — no hardcoded UUID.

## Phases
| # | Phase | Status |
|---|-------|--------|
| 01 | [Identity isolation (FE bearer + gateway resolveOwner)](phase-01-identity-isolation.md) | ✅ done |
| 02 | [Publish/share backend (schema, store, routes, proxy)](phase-02-publish-share-backend.md) | ✅ done |
| 03 | [Publish/share UI (share toggle, shared list, read-only view)](phase-03-publish-share-ui.md) | ✅ done |
| 04 | [Reassign legacy 'dev' chats (migration script)](phase-04-reassign-legacy.md) | ✅ done (run on :11000 pending operator sub) |

## Verification (260604)
- chat-service: 885 existing + 6 new sharing/isolation tests pass.
- gateway: 727 existing + 2 new owner-resolution regression tests pass.
- FE: 1672 tests pass. Typecheck adds 0 new errors (72 pre-existing repo errors unrelated).
- Reassign script dry-run/apply verified on throwaway DB; snapshot write made opt-in (`--snapshot`).

## Operator step (Phase 04 on :11000)
Get your Keycloak `sub` (GET `/api/auth/me` or decode the app JWT), then in the chat-service
container: `npm run reassign-owner -- --to <sub> --label <name> --apply`.

## Key dependencies
- Phase 02 depends on 01 (real owner must flow before sharing means anything).
- Phase 03 depends on 02 (UI consumes new routes). Phase 04 independent (ops).
