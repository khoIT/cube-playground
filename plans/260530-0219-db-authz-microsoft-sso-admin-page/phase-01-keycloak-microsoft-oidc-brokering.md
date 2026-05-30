---
phase: 1
title: "Keycloak Microsoft OIDC Brokering"
status: pending
priority: P1
effort: "1-2d (mostly devops/config)"
dependencies: []
---

# Phase 1: Keycloak Microsoft OIDC Brokering

## Overview
Configure the prod Keycloak realm to broker Microsoft (Entra) OIDC so users log in with their corporate Microsoft email, with JIT user creation mapping `email` + `name`. Authentication only — no per-game groups or app roles configured in Keycloak.

## Requirements
- Functional: Microsoft login works end-to-end; new users are JIT-created in KC; the KC token carries a stable `sub`, `email`, `name`.
- Non-functional: prod redirect URIs registered; secrets in env, never committed; local realm continues to work unchanged (dev parity).

## Architecture
- Keycloak realm → Identity Provider: Microsoft/OIDC (Entra tenant). First-broker-login flow set to auto-create users.
- Mappers: Entra `email`/`preferred_username` → KC `email`; `name` → KC name. **No** group/role mappers (authz is app-side now).
- The app's existing `/api/auth/keycloak/callback` (code exchange) is unchanged structurally; it just stops *depending* on `realm_access.roles` / `/games/*` groups (handled in Phase 3). It must tolerate their absence today.

## Related Code Files
- Modify (cube-playground): `server/src/services/keycloak-token-exchange.ts` — make role/group extraction tolerant of empty (no throw when `realm_access`/groups missing). Full removal happens in Phase 3.
- Reference: `phase-06-keycloak-sso-and-basic-rbac.md` in `260527-1539-cube-workspace-switching` (local realm already shipped).
- Config/infra (not in repo): KC realm export, Entra app registration (client id/secret, redirect URIs). Document required env in `docs/deployment-guide.md`.

## Implementation Steps
1. Register an Entra app (or reuse VNG SSO app): get client id/secret, set redirect URI to the KC broker endpoint `/realms/<realm>/broker/microsoft/endpoint`.
2. In KC: add Microsoft OIDC IdP, enable "trust email", first-login flow = create user + link by email.
3. Add attribute mappers for `email` and `name` only.
4. Register the app's prod redirect URIs (`/auth/callback`) on the KC client.
5. Make `keycloak-token-exchange.ts` not throw when `realm_access.roles`/groups are absent (return empty; Phase 3 stops reading them).
6. Verify a Microsoft login produces a KC token with `sub` + `email`; confirm the app callback completes (user will be `pending` until Phase 3 authz lands — acceptable).
7. Document env vars + realm settings in `docs/deployment-guide.md`.

## Todo List
- [ ] Entra app registration + secret in prod env
- [ ] KC Microsoft IdP + first-broker-login auto-create
- [ ] email/name mappers (no role/group mappers)
- [ ] prod redirect URIs registered
- [ ] token-exchange tolerant of missing roles/groups
- [ ] manual Microsoft login smoke test
- [ ] deployment-guide.md updated

## Success Criteria
- [ ] A Microsoft user can complete login; KC issues a token with stable `sub` + `email`.
- [ ] Local (non-Microsoft) realm login still works unchanged.
- [ ] Callback no longer errors on missing realm-roles/groups.

## Risk Assessment
- **Entra admin dependency** (cross-team): client registration + redirect URIs may need corp IT — start early, it gates prod. Mitigation: this phase can proceed in a staging realm while devops finalizes prod.
- **Email mutability:** corporate email changes orphan grants (grants keyed by email in Phase 2). Mitigation: documented caveat; `sub` captured for reconciliation.

## Security Considerations
- Brokering authenticates the entire MS tenant → authorization MUST default-deny (Phase 3). This phase intentionally leaves users unauthorized until the DB grant exists.
- Client secret in env/secret-store only.
