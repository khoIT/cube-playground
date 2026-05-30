---
phase: 3
title: "DB-Authoritative Login and Default-Deny"
status: pending
priority: P1
effort: "1d"
dependencies: [1, 2]
---

# Phase 3: DB-Authoritative Login and Default-Deny

## Overview
Rework the login flow so `role` and grants come from the app DB (by email), not Keycloak claims. Unknown/`pending`/`disabled` emails are authenticated but unauthorized → app returns a "request access" state and mints no privileged JWT. Capture KC `sub` on first match.

## Requirements
- Functional: active user → app JWT with DB-sourced role; pending/unknown → explicit `403 ACCESS_PENDING` with a friendly FE state; `sub` reconciled to the email row on first login.
- Non-functional: backward-compatible with `AUTH_DISABLED=true` dev path; no secrets logged.

## Architecture
- `services/keycloak-token-exchange.ts`: stop deriving `role`/`allowedGames` from KC; extract only `sub`, `email`, `name`.
- `services/app-jwt.ts`: claims become `{sub, username, email, role}` sourced from `access-store.getAccess(email)`. **Drop `allowedGames` from the JWT** — game access is resolved server-side per request from the store (Phase 4), not trusted from a client-held claim. (Verify no consumer reads the claim before removing; FE game filter switches to an API in Phase 4.)
- Callback logic:
  1. exchange code → `{sub,email,name}`
  2. `access = getAccess(email)`
  3. if `!access || status !== 'active'` → record audit + return `ACCESS_PENDING` (auto-create a `pending` `user_access` row so it surfaces in the admin queue)
  4. else mint app JWT with `role`; if `access.kc_sub` null, set it = `sub` (reconcile)
- `middleware/authenticate.ts`: unchanged contract (`req.user`), but `req.user` now reflects DB role. Keep `AUTH_DISABLED` dev synthesis.

## Related Code Files
- Modify: `server/src/services/keycloak-token-exchange.ts`, `server/src/services/app-jwt.ts`, the `/api/auth/keycloak/callback` route, `server/src/middleware/authenticate.ts`
- Modify (FE): `src/auth/auth-context.tsx` — handle `ACCESS_PENDING`; `AuthUser` drops `allowedGames` (moves to a games API in Phase 4).
- Create (FE): a "Request access / pending approval" screen rendered by `AuthGate` for pending users.
- Reference: `server/src/services/users-store.ts` (`upsertUser` audit on login).

## Implementation Steps
1. Trim token-exchange to identity-only.
2. Rewrite callback: resolve grants, default-deny with auto-`pending` row, reconcile `sub`.
3. Mint app JWT from DB role; remove `allowedGames` claim (grep consumers first).
4. FE: render pending/denied state in `AuthGate`; remove `allowedGames` reads from `AuthUser` (temporary stub until Phase 4 games API).
5. Tests: active→token, pending→403+row created, unknown→403+row created, sub reconciliation, AUTH_DISABLED still works.

## Todo List
- [ ] token-exchange identity-only
- [ ] callback default-deny + auto-pending row + sub reconcile
- [ ] app-jwt from DB role, drop allowedGames claim (after consumer grep)
- [ ] FE pending/request-access screen
- [ ] login flow tests (active/pending/unknown/dev)

## Success Criteria
- [ ] Active user logs in and gets DB role in `req.user`.
- [ ] Unknown/pending user is blocked with a clear "request access" UI and appears as `pending` in the DB.
- [ ] `kc_sub` is populated on first successful login.
- [ ] `AUTH_DISABLED=true` dev flow unaffected.

## Risk Assessment
- **Removing `allowedGames` claim** could break a hidden consumer. Mitigation: grep all readers; Phase 4 ships the replacement games API in the same release train — sequence merges so the claim isn't removed before the API lands.
- **Pending-row spam** from curious tenant users. Mitigation: rows are cheap; admin queue can filter; optional rate-limit on auto-create.

## Security Considerations
- This phase is the default-deny gate — the security backbone. No grant ⇒ no access, full stop.
- Never trust client-supplied game/role; resolve server-side from `getAccess`.
