# DB-Authoritative Authz + Microsoft SSO + Admin Page

**Date**: 2026-05-30
**Severity**: Critical
**Component**: auth, authorization, migrations, cube-integration, admin-api
**Status**: Resolved
**Plan**: plans/260530-0219-db-authz-microsoft-sso-admin-page/

## What Shipped

Demoted Keycloak to authentication-only (OIDC broker), moved authorization into the app. Playground now resolves role + grants from the SQLite store **per request**, keyed by lowercased email with default-deny semantics. Game enforcement closed the FE-only gap and tightened the Cube token contract.

### Phase 1 — AuthZ schema + migrations

- `migrations/019_access_schema.sql` — four tables: `user_access` (users, role, status, suspended_at, verified_at), `user_workspace_access` (org-scoped grants, role_config, active), `user_game_access` (per-game grants + status), `feature_flags` (user-level feature toggles). email lowercased and unique-indexed. Default-deny: login callback auto-creates `{email, status: 'pending'}` rows; non-active blocks with `403 ACCESS_PENDING` and FE request-access screen.
- `migrations/020_access_audit.sql` — append-only log: `user_id, action, old_state, new_state, actor_id, created_at, note`. Guards every write in the admin API.

### Phase 2 — Server-side grant resolution

- `authenticate.ts` — reads `user_access` + `user_workspace_access` + `user_game_access` per request (not JWT), resolves `role` + `allowedGames`, caches via `ACCESS_CACHE_TTL_MS` (fast revocation mid-session). JWT now carries identity only (`sub`, `email`); dropped the `allowedGames` claim.
- Keycloak `sub` reconciled in login callback: maps `sub` → `email` (lowercased) via optional `email_verified` claim from Entra/MSA. Failed auth (no email or non-active) → `403` with pending request row auto-created.
- `workspace-header.ts` enforces game gate server-side: `GAME_FORBIDDEN` error when `gameId` not in `allowedGames`. Cube token mints with `userId=email` so cube-dev's `checkAuth` re-enforces independently.

### Phase 3 — Workspace gate migration

- Old contract: workspace gate stored in Keycloak role config, FE filtered `allowedGames`. New contract: per-user `user_game_access` grants, enforced at request boundary.
- `AUTHZ_GRANT_FALLBACK` environment flag (true in staging, false post-seeding) — when true, a user with no explicit grant but a Keycloak role gets a temporary grant so existing sessions don't break. Flipped off in prod once grants seeded.

### Phase 4 — Admin API + audit

- Router-scoped `/api/admin/*` (requires `requireRole('admin')` + `requireFeature('admin')`). Three endpoints:
  - `GET /api/admin/users` — list all users with role, status, suspended_at.
  - `PATCH /api/admin/users/:email` — update role/status (idempotent, audit-trail).
  - `POST /api/admin/users` — upsert; reuses `upsertUserAccess` so last-admin lockout guard fires.
- Guard: prevents demoting/disabling the last active admin. **Critical fix** caught in code review — the guard lived only in setRole/setStatus (PATCH) but `POST /api/admin/users` (upsert) bypassed it via `INSERT OR REPLACE` clobbering existing rows. Fixed by guarding inside `upsertUserAccess` + passing `role` through (don't default-clobber) + regression test.
- `POST /api/admin/access/action/:email` — fire an audit event manually (e.g., "verified by admin", "suspended for security incident").

### Phase 5 — FE admin page + cube-dev integration

- `src/pages/Admin/AccessPage.tsx` — read-only table (users, role, status, verified_at) + action buttons (set-role, suspend, verify-pending). Role/suspend buttons open modals that call PATCH endpoints; responses show toast + refetch the list.
- `cube-dev/auth-db.js` — queries `GET /internal/access/:key` on playground (shared-secret, TTL cache, fail-closed, local fallback). Cube respects `userId` as the source-of-truth for access checks.

### Phase 6 — Bootstrap + cutover safety

- `AUTH_BOOTSTRAP_ADMINS` env var (JSON array of emails) — seeded in migrations/019 as active admins. Prod bootstraps the first org admin from this list.
- No behavioral API changes for existing game-gate consumers; old and new paths coexist until AUTHZ_GRANT_FALLBACK is false.

## Decisions Worth Remembering

**Authenticate ≠ authorize.** Keycloak brokers the IdP (Microsoft Entra in prod, local OIDC in dev). App **must default-deny**: non-existent email → `403 ACCESS_PENDING`, require explicit grant. Resolving permissions server-side per request (not trusting JWT role) lets the app revoke access mid-session.

**FE-only game gate was not enforcement.** Prior design: `/meta` check on client, FE filtered `allowedGames` from JWT claim. Vulnerability: client could forge a Cube token and hit `/meta` directly. Fix: server-side game gate in `workspace-header.ts` + Cube token mints with `userId=email` so cube-dev's second-hop enforces independently. Two hops, two checks.

**Last-admin lockout lives in the upsert, not the patch.** Code review caught a critical gap: `PATCH /api/admin/users` guarded against demoting the last admin, but `POST /api/admin/users` (upsert logic for bulk-import or API automation) bypassed the guard via `INSERT OR REPLACE` clobbering existing rows. An admin could POST a payload that demotes the last active admin and lock the org out. Fixed by moving the guard into the shared `upsertUserAccess` helper so all callers respect it. Test added to prevent regression.

**Default-deny + gradual fallback.** Staging rolls out with `AUTHZ_GRANT_FALLBACK=true` (existing Keycloak roles auto-grant, no user impact). Once admins seed the SQLite grants, flip to `false` (Keycloak roles become advisory/ignored, SQLite is the single source of truth). Single-flag rollback if needed.

**Audit trail in the DB, not YAML.** Unlike broken-metric trust history, access changes are multi-actor (admins managing users). Append-only DB log captures `old_state`, `new_state`, `actor_id`, `note` for compliance and incident review.

**Email is the user key, lowercased.** Entra/Microsoft IdP claims email in various cases. Normalizing to lowercase prevents duplicate rows for `khoitn@vng` vs `KHOITN@vng`. Unique index enforces this constraint.

## Commits

- cube-playground `5412a1b` — migrations, auth, admin API, routes, FE page.
- cube-dev `75b2e34` — auth-db.js integration, checkAuth reuse.

## Test Coverage

- Server: 351 tests passing (new tests cover login callback, grant resolution, game gate, admin endpoints, last-admin guard, audit trail).
- Regression: last-admin lockout via POST (new test prevents bypass).

## Deferred to DevOps

- KC/Entra realm config (OIDC client, redirect URIs, email claim mapping).
- Prod credential seeding: `AUTH_BOOTSTRAP_ADMINS`, `INTERNAL_API_SECRET`.
- Cross-repo staging rollout: flip `AUTHZ_GRANT_FALLBACK`, monitor sessions.

## Follow-ups

- Once grants are seeded in prod, flip `AUTHZ_GRANT_FALLBACK=false` to remove the Keycloak role fallback.
- Entra-specific edge cases (multi-tenant orgs, group claims, service principals) — defer to prod incident discovery.
- Cross-workspace org policies (e.g., "all users in OU must be admins") — YAGNI for single-player, API exists to batch-set roles.
