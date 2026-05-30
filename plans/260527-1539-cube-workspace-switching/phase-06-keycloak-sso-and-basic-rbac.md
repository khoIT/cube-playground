---
phase: 6
title: "Keycloak SSO + basic RBAC"
status: pending
priority: P2
effort: "3d"
dependencies: [1, 4]
---

# Phase 6: Keycloak SSO + basic RBAC

> **Superseded (2026-05-30):** the still-pending "VNG prod realm / redirect URIs"
> item and the KC-derived role/group authorization are superseded by
> `plans/260530-0219-db-authz-microsoft-sso-admin-page/` — KC is now
> authentication-only (brokers Microsoft/Entra), and authorization moved to the
> app DB (default-deny). Prod realm config is tracked there (Phase 1).

## Overview
Replace the unvalidated `X-Owner` header with **validated identity via Keycloak SSO**, then
gate three things by role: **workspace access**, **artifact write/ownership**, and
**per-game access**. Sequenced last ("workspace first, RBAC follows"); hardens the interim
owner-header posture used by Phases 4–5.

## Reference architecture
Mirror `/Users/lap16299/Documents/code/duongnt5` (verified pattern) — adapted to our stack
(**Fastify/Node + SQLite**, not FastAPI/Postgres):
- Public OIDC client, Authorization-Code flow, **no Keycloak SDK** (custom, like reference).
- Frontend fetches KC config from `GET /api/auth/keycloak/config`; redirects to KC auth;
  `/auth/callback` posts `code` to server.
- **Server exchanges `code` → Keycloak token → mints its own app JWT (HS256)** and returns it;
  frontend stores app JWT (localStorage `token` is acceptable for the *auth token* — this is
  what the reference does; the "no localStorage" rule is for data artifacts, not the session token).
- **Keycloak is the source of truth** for roles AND per-game access (devops manages users,
  roles, and groups in the Keycloak admin UI — no in-app user-management screen). The app
  **derives authorization from the token each request**; no local-override, no `allowed_games`
  table. A thin `users` table is kept only as an audit/ownership cache (FK for `segments.owner`
  etc.), upserted on login — never authoritative for role/games.
- Guards: server `requireRole(...)` Fastify preHandler; frontend `ProtectedRoute allowedRoles`.

## Requirements
- Functional: real login; every API call carries the app JWT; `req.user = { id, username,
  role, allowedGames? }` resolved server-side. RBAC enforced on workspace, artifacts, games.
- Non-functional: `jsonwebtoken` already a dep (cube-token minting) — reuse for app JWT;
  verify Keycloak token via JWKS (`jwks-rsa`/`jose`) rather than unverified-decode where feasible.

## Architecture
- **Role enum**: `viewer | editor | admin` (start minimal; add `superadmin` only if needed — YAGNI).
- **Identity middleware** replaces `owner-header.ts`: validate app JWT → `req.user`. Keep a
  back-compat dev mode (env `AUTH_DISABLED=true` → synthesize owner) so local dev still works.
  Segment/alias `owner` becomes `req.user.id` (was the header string) — migrate the column meaning.
- **RBAC enforcement points:**
  1. **Workspace access** — workspace registry (Phase 1) gains `allowedRoles?: string[]`
     (e.g. prod = `['editor','admin']`). `/api/workspaces` returns only permitted; the
     `x-cube-workspace` preHandler rejects unauthorized ids (403).
  2. **Artifact write/ownership** — `viewer` read-only; `editor` writes own; `admin` writes any.
     Apply on aliases, segments, drafts, dashboards routes via `requireRole` + ownership check
     (extend the existing 403-on-owner-mismatch in `segments.ts`).
  3. **Per-game access** — from **Keycloak groups** in the token (e.g. group `/games/cfm`
     → game `cfm_vn`). Server reads `groups` claim → allowed game list → filters meta/segments
     to allowed games; intersect with the Phase 3 prefix/game_id filter. Group→game mapping
     lives in workspace/games config, not a per-user table.
- **Keycloak config**: realm + public client + redirect URIs; `realm-export.json` for local
  docker-compose (mirror reference). Env: `KEYCLOAK_URL`, `KEYCLOAK_REALM`,
  `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET?`, `JWT_SECRET`, `JWT_EXPIRE_MINUTES`.

## Related Code Files
- Create: `server/src/routes/auth.ts` (config, callback, me, logout),
  `server/src/middleware/authenticate.ts` (replaces `owner-header.ts`),
  `server/src/middleware/require-role.ts`,
  `server/src/services/keycloak-token-exchange.ts`,
  `server/src/db/migrations/018-users-audit.sql` (thin users cache: sub, username, last_login — NO authoritative role/games),
  `keycloak/realm-export.json`
- Modify: `server/src/index.ts` (register auth + authenticate preHandler),
  `server/src/routes/{segments,aliases,user-prefs,business-metrics}.ts` (requireRole + ownership),
  `server/src/services/workspaces-config-loader.ts` (`allowedRoles` + filtering)
- Create (frontend): `src/auth/auth-context.tsx`, `src/auth/protected-route.tsx`,
  `src/pages/auth/callback.tsx`, login page
- Modify (frontend): `src/api/api-client.ts` + cube SDK factory (Bearer app JWT; 401 → login),
  topbar/AvatarMenu (real user), workspace switcher (hide unpermitted), GamePicker (allowed games)
- Modify: `docker-compose`/dev scripts (Keycloak service), `.env.example`

## Implementation Steps
1. Stand up Keycloak (docker-compose + realm-export) with `viewer/editor/admin` roles + test users.
2. Server: `/api/auth/keycloak/config`, `/callback` (code→KC token→app JWT), `/me`, `/logout`;
   `users` migration + auto-provision + KC-role→app-role map.
3. Replace `owner-header` with `authenticate` preHandler (`AUTH_DISABLED` dev escape hatch);
   migrate `owner` semantics to `req.user.id`.
4. Frontend: AuthContext + login + `/auth/callback` + Bearer interceptor + 401→login; ProtectedRoute.
5. Enforce workspace `allowedRoles` (registry + `/api/workspaces` + preHandler).
6. Enforce artifact ownership/role on aliases/segments/drafts/dashboards.
7. Enforce per-game access (KC `groups` claim → allowed games → meta/segment filter, intersect Phase 3).
8. Verify with 3 test users (viewer/editor/admin): workspace visibility, write gating, game scoping.

## Success Criteria
- [ ] Login via Keycloak; app JWT minted server-side; every API call validated (`req.user`).
- [ ] `viewer` cannot write; `editor` writes own; `admin` writes any (segments/aliases/drafts).
- [ ] Prod workspace hidden/blocked for non-permitted roles (403 on forced id).
- [ ] Per-game access limits visible cubes/segments to a user's allowed games.
- [ ] `AUTH_DISABLED=true` keeps local dev frictionless.

## Risk Assessment
- **Stack mismatch with reference** — duongnt5 is Python; reuse the *flow/architecture*, not
  code. Validate KC token via JWKS in Node (`jose`/`jwks-rsa`) for correctness.
- **`owner` re-keying** — new owner id = **`preferred_username`** (validated) from Keycloak.
  Migration maps today's owner strings (`'dev'`, etc.) → KC `preferred_username`; provide a
  one-shot ownership-transfer script for stranded artifacts.
- **Keycloak realm/client provisioning** — needs a real VNG Keycloak realm + redirect URIs for
  prod; local uses docker realm-export. Confirm realm name + client id with infra. (open question)
- **Group→game naming contract** — app depends on a KC group convention (e.g. `/games/<prefix>`);
  agree the naming with devops up front so the `groups` claim maps cleanly to games. Roles + groups
  managed entirely in Keycloak UI (source of truth) — app never edits them.
