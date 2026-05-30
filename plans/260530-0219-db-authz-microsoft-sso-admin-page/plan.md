---
title: "DB-Authoritative Authz + Microsoft SSO + Admin Access Page"
description: "Demote Keycloak to authentication-only (broker Microsoft OIDC), move authorization (role + workspace/game/feature grants) into the app DB with default-deny, and ship an admin page to toggle per-user access."
status: pending
priority: P1
branch: "main"
tags: [auth, rbac, keycloak, admin, multi-tenant]
blockedBy: [260527-1539-cube-workspace-switching]
blocks: []
created: "2026-05-29T19:22:16.281Z"
createdBy: "ck:plan"
source: skill
---

# DB-Authoritative Authz + Microsoft SSO + Admin Access Page

## Overview

**Goal:** Make the app's authorization self-contained and admin-manageable, while Keycloak handles only authentication (brokering Microsoft/Entra OIDC for prod).

**Why now:** Prod login moves to Keycloak→Microsoft OIDC with JIT users. That authenticates the *whole* MS tenant, so the app needs its own allowlist with default-deny. The current `role`/`allowedGames` claims are derived from Keycloak realm-roles/groups — both will be **empty** for brokered JIT users. Authorization must move to a writable app store, which also unlocks the admin page.

**Architecture decision (Option B):** Authentication = Keycloak (broker Microsoft, JIT, map email+name). Authorization = app SQLite, keyed by **lowercased email** (pre-provisionable before first login), with `sub` captured on first login. Decisions read DB-first. Admin page writes the DB only — **no Keycloak Admin API** integration. cube-dev's game gate reads the same source (its existing `TODO(prod)`), closing the minted-path enforcement gap.

**Non-goals:** Mutating Keycloak/Entra from the app; SCIM provisioning; group-based Entra mapping; bulk-import tooling (YAGNI for v1).

## Key Insights (from scouting, do not re-derive)
- `services/app-jwt.ts` mints `{sub, username, email, role, allowedGames}`; `role` ← KC `realm_access.roles`, `allowedGames` ← KC groups `/games/<id>`. Both break under Microsoft brokering.
- `users` table (`migrations/018-users-audit.sql`) is **audit-only**, never read for decisions. No grant tables exist.
- Workspace gate is **per-role** from static `workspaces.config.json` (`workspaceAllowsRole`); game gate (FE) in `use-game-context.ts`; features are **localStorage cosmetic only** (no enforcement).
- **Server-side game enforcement gap:** local/minted path mints `{userId:'playground'}` (allowlisted for all games) → per-user game limits are FE-only. Must enforce server-side.
- cube-dev `cube/auth-db.js` reads static `auth-users.json` keyed by userId; has `TODO(prod)` to swap for a DB query.

## Identity & data-model contract
- **Grant key:** `email` (lowercased, trimmed). Enables admin to pre-authorize before first login.
- **Stable id:** capture KC `sub` on first successful login (reconcile to the email row) for audit; never the grant key.
- **Default-deny:** unknown or `pending` email → authenticated but unauthorized → app returns a "request access" state, no app JWT minted with grants.
- **Roles:** keep `viewer | editor | admin` (already in JWT + write-role enforcement). Role now sourced from DB, not KC.

## Dependencies
- Builds on completed Phase 6 (Keycloak SSO + basic RBAC) of `260527-1539-cube-workspace-switching`; this plan supersedes that plan's still-pending "VNG prod realm/redirect URIs" item (handled in Phase 1 here).
- Phase order: P2 (DB) + P1 (KC) are foundational → P3 (login) → P4 (gates) + P6 (admin API) → P7 (UI); P5 (cube-dev) depends only on P2; P8 hardens all.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Keycloak Microsoft OIDC Brokering](./phase-01-keycloak-microsoft-oidc-brokering.md) | Code+docs done; KC/Entra realm config pending devops |
| 2 | [Auth DB Schema and Access Store](./phase-02-auth-db-schema-and-access-store.md) | Done |
| 3 | [DB-Authoritative Login and Default-Deny](./phase-03-db-authoritative-login-and-default-deny.md) | Done |
| 4 | [Decision-Layer Refactor (Workspace/Game/Feature)](./phase-04-decision-layer-refactor-workspace-game-feature.md) | Done |
| 5 | [cube-dev Shared Authz Source](./phase-05-cube-dev-shared-authz-source.md) | Code done; cross-repo proxy smoke pending devops |
| 6 | [Admin Access API](./phase-06-admin-access-api.md) | Done |
| 7 | [Admin Access UI](./phase-07-admin-access-ui.md) | Done |
| 8 | [Tests Docs and Rollout](./phase-08-tests-docs-and-rollout.md) | Tests+docs done; staging rollout pending devops |

## Implementation notes (deviations from plan)

- **`allowedGames` JWT claim removed; resolved per-request from DB.** Rather than ship a separate `GET /api/games`, the FE switcher keeps reading `user.allowedGames` — but that value now comes from `/api/auth/me` computed server-side from the DB (not a decoded client JWT). The signed JWT carries identity only; `authenticate.ts` resolves role+games+features from `getAccess(email)` each request (mid-session revocation within `ACCESS_CACHE_TTL_MS`). Server-side game enforcement (the security fix) lives in `workspace-header.ts` (`GAME_FORBIDDEN`).
- **Feature map** delivered via `/api/auth/me` `user.features` (not a separate `/api/me/features`).
- **`admin` feature** defaults enabled for `role==='admin'` so bootstrap admins aren't locked out; explicit flags still override.
- **Phase 5 source = internal API (option B):** `GET /internal/access/:key` (shared secret `CUBE_AUTH_INTERNAL_SECRET`); cube-dev `auth-db.js` calls it with TTL cache + fail-closed, file fallback for local dev.
- **Migration fallback flag** `AUTHZ_GRANT_FALLBACK` (default on) relaxes zero-grant users to role-based defaults; flip off after seeding (Phase 8 rollout).
- Test counts: server suite 351 green (incl. access-store, default-deny login, admin API authz, game-gate fail-closed, internal-access). Pre-existing unrelated FE tsc errors (cdp-projection, Settings, perf-probe) left untouched.

## Dependencies

<!-- Cross-plan dependencies -->
