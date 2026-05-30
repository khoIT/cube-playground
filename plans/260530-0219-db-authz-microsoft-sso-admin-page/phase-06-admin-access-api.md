---
phase: 6
title: "Admin Access API"
status: pending
priority: P1
effort: "1d"
dependencies: [2, 4]
---

# Phase 6: Admin Access API

## Overview
Expose admin-only endpoints to list users and mutate their role, status, and workspace/game/feature grants — the API surface the admin UI drives. Writes go to the Phase 2 store only; all routes gated by `requireRole('admin')` with an audit trail.

## Requirements
- Functional: list users (active + pending) with their grants; PATCH role/status/workspaces/games/features per user; list available workspaces/games/feature-keys for the UI's option lists.
- Non-functional: every mutation audited (who/what/when); admin-only; idempotent PATCH semantics; cache invalidation on write.

## Architecture
- New router `server/src/routes/admin-access.ts`, all routes behind `requireRole('admin')` preHandler (role already in JWT from Phase 3).
- Endpoints:
  - `GET /api/admin/users` → `[{email, role, status, kc_sub, workspaces[], games[], features{}, lastLogin}]` (join audit `users` for lastLogin).
  - `POST /api/admin/users` → pre-provision by email (`status='active'`, optional grants) — the invite-before-login path.
  - `PATCH /api/admin/users/:email` → `{role?, status?}`.
  - `PUT /api/admin/users/:email/workspaces` `{workspaceIds[]}`; same for `/games`; `PUT /api/admin/users/:email/features` `{featureKey: bool}`.
  - `GET /api/admin/registry` → `{workspaces[], games[], featureKeys[]}` from configs + `feature-keys.ts` for the UI's checkboxes.
- Audit: append to an `access_audit(actor_email, action, target_email, detail_json, ts)` table (small migration, or reuse a generic audit table if one exists). Mutators call `access-store` (which invalidates cache).
- Reuse existing write-role enforcement pattern (`enforce-write-roles`) where applicable, but admin routes need the stricter `requireRole('admin')`.

## Related Code Files
- Create: `server/src/routes/admin-access.ts`, `server/src/middleware/require-role.ts` (`requireRole('admin')`), `server/src/db/migrations/020-access-audit.sql`
- Modify: register router in the server route bootstrap; `access-store.ts` mutators (from Phase 2) consumed here.
- Reference: `server/src/routes/settings.ts` (PATCH + write-role gating pattern), `middleware/authenticate.ts` (`req.user.role`).

## Implementation Steps
1. `require-role.ts` preHandler (`403` if `req.user.role !== 'admin'`).
2. `admin-access.ts` with the endpoints above; wire to `access-store`.
3. `access_audit` migration + write on every mutation.
4. `GET /api/admin/registry` from configs + feature-keys.
5. Tests: non-admin → 403 on every route; admin CRUD round-trips; audit row written; cache invalidated.

## Todo List
- [ ] requireRole('admin') preHandler
- [ ] admin-access router (list/create/patch/put grants + registry)
- [ ] access_audit migration + writes
- [ ] registry endpoint
- [ ] authz tests (non-admin 403; admin round-trip; audit; cache)

## Success Criteria
- [ ] Non-admin gets 403 on all `/api/admin/*` routes.
- [ ] Admin can list users, pre-provision by email, and toggle role/status/workspace/game/feature grants; changes take effect on the user's next request (cache TTL) without restart.
- [ ] Every mutation produces an audit row.

## Risk Assessment
- **Privilege escalation** if `requireRole` is missing on any route. Mitigation: apply at router scope, not per-route; test asserts 403 on every path.
- **Admin self-lockout** (demoting last admin). Mitigation: guard — refuse to remove the last `active` admin.

## Security Considerations
- Admin-only at router scope; audit all writes; normalize email on input.
- No Keycloak mutation — strictly app-DB writes (per architecture decision).
