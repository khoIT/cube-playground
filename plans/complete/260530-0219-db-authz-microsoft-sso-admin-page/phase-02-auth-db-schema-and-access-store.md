---
phase: 2
title: "Auth DB Schema and Access Store"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 2: Auth DB Schema and Access Store

## Overview
Add the writable authorization store: SQLite tables for per-user role + workspace/game/feature grants keyed by lowercased email, plus a read-through `access-store` service with a short TTL cache. This is the single source of truth every gate and the admin API will use.

## Requirements
- Functional: persist role, status (`pending|active|disabled`), and per-user workspace/game/feature grants; resolve all grants for an email in one call.
- Non-functional: lookups cheap (cache, bounded), migrations idempotent, schema forward-compatible with a future `role`-scoped feature flag.

## Architecture
- Reuse the existing SQLite + migration runner (`server/src/db/migrations/`, next index `019+`). No new DB engine (KISS).
- Tables (email lowercased, trimmed):
  - `user_access(email PK, role TEXT CHECK(viewer|editor|admin), status TEXT CHECK(pending|active|disabled) DEFAULT 'pending', kc_sub TEXT NULL, created_at, updated_at)`
  - `user_workspace_access(email, workspace_id, PRIMARY KEY(email, workspace_id))`
  - `user_game_access(email, game_id, PRIMARY KEY(email, game_id))`
  - `feature_flags(scope TEXT CHECK(user|role), subject TEXT, feature_key TEXT, enabled INTEGER, PRIMARY KEY(scope, subject, feature_key))` — `subject` = email or role name. `role` scope covers defaults; `user` scope overrides.
- `access-store.ts` service: `getAccess(email)` → `{ role, status, workspaces[], games[], features{} } | null`; mutators used by the admin API (Phase 6). In-process TTL cache (~30–60s) keyed by email; invalidate on write.
- Feature-key registry: a typed const list (e.g. `chats`, `liveops`, `catalog`, `dashboards`, `segments`, `query-builder`, `admin`) so the admin UI and gates share one vocabulary — `server/src/auth/feature-keys.ts` shared with FE via a small generated/const module.

## Related Code Files
- Create: `server/src/db/migrations/019-auth-grants.sql`
- Create: `server/src/auth/access-store.ts` (read-through + mutators + cache)
- Create: `server/src/auth/feature-keys.ts` (canonical feature key enum, shared)
- Reference: `server/src/db/migrations/018-users-audit.sql` (audit table — keep; `kc_sub` reconciliation joins to it), `014-app-settings.sql` (migration style).

## Implementation Steps
1. Write `019-auth-grants.sql` with the four tables + indexes on `email`.
2. Implement `access-store.ts`: `getAccess`, `setRole`, `setStatus`, `setWorkspaces`, `setGames`, `setFeatures`, `listUsers`, with TTL cache + invalidation.
3. Define `feature-keys.ts` (canonical keys derived from current nav sections in `use-visible-nav-items.ts`).
4. Seed: insert the current operators as `active` admins (bootstrap so nobody is locked out at cutover) — seed migration or idempotent startup seed gated by env (`AUTH_BOOTSTRAP_ADMINS=email1,email2`).
5. Unit tests for `access-store` (resolve, override precedence user>role for features, cache invalidation).

## Todo List
- [ ] migration 019 (4 tables + indexes)
- [ ] access-store service (read-through + mutators + cache)
- [ ] feature-keys canonical registry
- [ ] bootstrap-admin seed (env-gated)
- [ ] access-store unit tests

## Success Criteria
- [ ] Migration applies cleanly on a fresh and existing DB.
- [ ] `getAccess(email)` returns merged grants; user-scoped feature flag overrides role-scoped.
- [ ] Bootstrap admins resolve as `active` admin without manual SQL.
- [ ] Cache invalidates on any mutator write.

## Risk Assessment
- **Lockout at cutover** if no admin exists in the new tables. Mitigation: env-gated bootstrap-admin seed (step 4) is mandatory before Phase 3 deploy.
- **Feature-key drift** between FE/BE. Mitigation: single shared `feature-keys.ts`; gates and UI import it.

## Security Considerations
- Email normalized (lowercase/trim) on write AND read to prevent duplicate-grant bypass.
- `disabled` status distinct from `pending` so revocation is explicit and audit-visible.
