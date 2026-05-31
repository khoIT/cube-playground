---
name: authz-architecture
description: DB-authoritative authz model in cube-playground server — per-request role/grant resolution, fail-closed contract, last-admin guard, and the upsert bypass gap.
metadata:
  type: project
---

DB-authoritative authorization (server/src/auth/). Authentication (Keycloak/Microsoft) is separate from authorization; grants live in `user_access` keyed by lowercased email.

**Why:** the app moved authz out of the client-held JWT into the DB so revocation/grant edits take effect within a cache TTL (default 30s) without re-login.

**How to apply when reviewing auth changes:**
- `request.user.role` is resolved per-request from `getAccess(email)` in `authenticate.ts`, NEVER from `claims.role`. The JWT no longer carries `allowedGames`. So a forged/stale JWT role cannot escalate — verify any new code keeps reading from the DB access store, not the token.
- Fail-closed contract: non-active/unknown/missing-email user → `request.user` left undefined → protected routes 401/403. Confirm new gates default to DENY on ambiguity.
- Last-admin guard lives ONLY in `setRole`/`setStatus` (mutators). `upsertUserAccess` (ON CONFLICT DO UPDATE on role+status) does NOT call the guard — so `POST /api/admin/users` with an existing admin's email can demote/disable the last admin and lock everyone out. If you see upsert used on the admin create path, flag it.
- `AUTHZ_GRANT_FALLBACK` (default true): a user WITH grants in a dimension is always checked against them; only a user with ZERO grants falls back to permissive (role-gate for workspaces, allow-all for games). Flipping to false makes gates fully fail-closed. Fallback never widens an explicitly-granted user.
- Cross-repo: playground mints Cube JWT `userId = email`; cube-dev `auth-db.js` resolves by email via `GET /internal/access/:key`. Secret env names DIFFER by design: playground `CUBE_AUTH_INTERNAL_SECRET`, cube-dev `AUTH_INTERNAL_SECRET` — both must be set to the same value (documented in cube-dev/.env.example). cube-dev fails closed on any non-200.
