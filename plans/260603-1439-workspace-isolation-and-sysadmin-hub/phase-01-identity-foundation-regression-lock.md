---
phase: 1
title: "Identity Foundation & Regression Lock"
status: complete
priority: P1
effort: "2-3d"
dependencies: []
---

# Phase 1: Identity Foundation & Regression Lock

## Overview
Fix the cross-cutting `owner(sub) ≠ email` identity duality and lock the **current** isolation + authz behavior behind golden tests before any of it is modified. This is the TDD regression net for the whole plan — every later phase relies on a stable, correct identity key.

## Key Insight (verified + red-team corrected)
- Artifacts (`segments`, `dashboards`, `cube_aliases`, `user_prefs`, chat `owner_id`) are written with `owner = req.owner` = Keycloak **sub** (`authenticate.ts:111,116`).
- Access grants (`user_access`), `access_audit`, and the admin UI key on **email** (lowercased, normalized).
- **Canonical sub↔email map = `user_access.kc_sub` (migration 019), NOT `users`.** Red-team: `users.email` is nullable + unindexed (`018-users-audit.sql:17,26`) and only exists post-first-login (`users-store.ts:34`) → invited-not-logged-in users (the admin pre-provision target) resolve **null**, re-creating the bug. `user_access.kc_sub` is the maintained, indexed, reconciled-on-login map (`access-store-mutators.ts:100`, `auth.ts:104`).
- Unified-concept-fabric drift note (phase-02 line 60): code review caught owner-scoping passing `req.user.email` against `owner=sub` rows → "never matched / was null in dev."
- **Telemetry + owner-scoping resolve on `sub`** (always present via `req.owner`); email is a display join via `user_access.kc_sub`.

## Requirements
- Functional:
  - A single identity helper resolving the request principal to BOTH keys: `{ sub, email }`, sourced from `req.user` (email) + `req.owner` (sub), backed by the `users` map for lookups in either direction.
  - All owner-scoped reads/writes use `sub` consistently; all access/telemetry/admin surfaces use `email` consistently; no surface mixes them.
  - Dev mode (`AUTH_DISABLED=true`) yields a deterministic principal (`sub` + synthetic email) so local isolation tests are meaningful (today dev owner is a fixed string → all users collapse to one).
- Non-functional: zero behavior change for existing single-user/dev flows; no schema migration needed (reuse `users`).

## Architecture
- New `server/src/auth/principal.ts`: `resolvePrincipal(req) -> { sub, email, role, workspaces, allowedGames, features }` — the ONE place that reads `req.user`/`req.owner`. Existing routes keep using `req.owner`/`req.user`; the helper centralizes the mapping + adds `emailForSub(sub)` / `subForEmail(email)` lookups against **`user_access.kc_sub`** (NOT `users`).
- Document the invariant in code comments: **owner column = sub; grant/audit key = email; telemetry key = sub (email = display join).** (No plan-ref labels per repo rule.)
- No new table. `subForEmail` reads `user_access.kc_sub`; returns null when a pre-provisioned email hasn't logged in (no sub yet) → callers fall back to email-keyed grant only.
- **`AUTH_DISABLED` prod guard (red-team F5):** add a boot-time fail-closed — if `AUTH_DISABLED` is truthy AND `NODE_ENV==='production'`, refuse to start (or hard-disable the bypass). Dev-mode synth principal MUST use a non-routable email domain (e.g. `@dev.invalid`) so synth identities can never collide with real grants/telemetry.
- **Verify before building dev-principal machinery (red-team M2):** existing tests already simulate multi-user via the `X-Owner` header override (`authenticate.ts:125,135`, `owner-header.test.ts`). If `X-Owner` + a seeded `user_access` row is sufficient to exercise isolation tests, prefer that over new env-gated dev-principal code (YAGNI).

## Local-Stack & Cube Real-Auth Cutover (folded in 2026-06-03)
User decision: **real auth on stack (`:11000`) + prod; dev (`:3000`) keeps the bypass.** The F5 boot-guard above already forces the stack's hand — `:11000` runs `NODE_ENV=production` + `AUTH_DISABLED=true`, so once the guard ships the stack fails to boot until it cuts over to `AUTH_DISABLED=false`. Dev runs `NODE_ENV=development`, so its bypass survives the guard (intended asymmetry — accept).

Blockers this cutover must clear (verified 2026-06-03):
- **Stack `user_access` is empty (0 rows, 0 game grants).** Real auth → `getAccess('khoitn@vng.com.vn')` null → 401 everywhere. `bootstrap-admins.ts` must seed `khoitn@vng.com.vn` as active admin on boot (admin → all access); confirm the bootstrap-admin env carries it in `.env.docker.local` + Vault.
- **Cube principal under real auth — DECISION NEEDED, consistent with the locked "binary game access":** `cube-token.ts:38` mints `userId:'playground'` with NO user email → bridge `getAccess('playground')` null → cube 404/deny. Pick one:
  - (a) **Service principal:** seed a `playground` `user_access` row with the exposed games; server stays the RBAC authority, cube trusts the minted token. Lighter; matches the current route.
  - (b) **Per-user:** `cube-token` route passes `req.principal.email`; cube resolves each user's grants via the bridge (admin → all games). Needs the cube-side admin/all-games path — the `'*'`-wildcard expansion already landed in `cube-dev/cube/cube.js#checkAuth` (2026-06-03), but the bridge must emit `'*'` for admin (or enumerate games).
- **Already in place (2026-06-03, orthogonal — keep):** `cube.js` `'*'`-wildcard expansion; `CUBEJS_REFRESH_WORKER=true` (pre-aggs build, `revenue_vnd` verified); workspace default `local`.

Caveat: dev-on-bypass won't exercise the bridge/RBAC path, so auth-path bugs (e.g. the wildcard one) surface only on stack/prod → add a bridge smoke-test before shipping auth-touching changes.

## Related Code Files
- Create: `server/src/auth/principal.ts`, `server/src/auth/__tests__/principal.test.ts`
- Create (golden regression suite): `server/src/__tests__/isolation-baseline.test.ts`
- Read/modify (thread helper, no behavior change): `server/src/middleware/authenticate.ts`, `server/src/services/users-store.ts`
- Read (lock current behavior): `server/src/routes/segments.ts`, `server/src/routes/dashboards.ts`, `chat-service/src/db/chat-store.ts`

## TDD: Tests First
1. **Lock the INVARIANTS that must NOT change** (red-team: the golden suite must pin invariants, not the assertion Phase 2 rewrites):
   - `isolation-baseline.test.ts`: dashboards filter by `owner=sub`+game+workspace; chat sessions filter by `owner_id`(=sub); dev `req.owner` deterministic; authz default-deny 403s `ACCESS_PENDING`. These are LOCKS — they must stay green through Phase 2.
   - The segment-LIST "returns all" behavior is a **fixture-to-replace**, NOT a lock. Mark it explicitly so Phase 2's flip to owner-private is an intentional, reviewed diff (not a silent regression). The existing `server/test/segment-multi-user-scoping.test.ts` (cross-owner delete → 204) likewise encodes the OLD contract and is owned/updated by Phase 2.
   - `principal.test.ts`: sub↔email round-trips via `user_access.kc_sub`; null when email unmapped (pre-login); synth dev principal uses non-routable domain.
2. Run; confirm invariant locks pass against current code.
3. Implement `principal.ts`; thread through `authenticate.ts` without changing outputs.
4. Re-run full server suite — invariant locks green; do not regress unrelated tests (~602 pass baseline per unified-concept-fabric outcome, minus the 6 known pre-existing failures).

## Implementation Steps
1. Add golden `isolation-baseline.test.ts` + `principal.test.ts` (tests-first).
2. Implement `resolvePrincipal` + `emailForSub`/`subForEmail` over `users-store`.
3. Add deterministic dev-mode principal (env-gated) so multi-user can be simulated locally.
4. Wire helper into `authenticate.ts` (decorate `req.principal`), leaving `req.owner`/`req.user` intact for back-compat.
5. Run full suites (server + chat-service `tsc`); confirm zero regressions.
6. **Stack/prod real-auth cutover:** ensure `bootstrap-admins` seeds `khoitn@vng.com.vn` (active admin); pick the cube principal (service-principal row vs per-user email per the section above); flip `.env.docker.local` (+ Vault) `AUTH_DISABLED=false`; recreate `cube_api`; verify Keycloak login + a cube query succeed on `:11000`. Leave dev (`:3000`) on the bypass.

## Success Criteria
- [ ] `principal.ts` is the single resolver; sub↔email lookups go through `user_access.kc_sub` (NOT `users`); covered by tests incl. the null-when-pre-login case.
- [ ] Invariant lock suite (chat/dashboard scoping, dev owner, default-deny) passes and is documented as must-not-change; segment-LIST behavior marked fixture-to-replace.
- [ ] Multi-user simulatable in tests (via `X-Owner`+seeded grant, or synth dev principal w/ non-routable domain if needed).
- [ ] `AUTH_DISABLED` truthy under `NODE_ENV=production` fails closed at boot (tested).
- [ ] Full server suite green; `tsc` clean (server + chat-service); no schema migration added.
- [ ] Stack/prod cutover: `khoitn@vng.com.vn` auto-provisioned as active admin; cube principal decided + resolvable; `:11000` runs `AUTH_DISABLED=false` with working Keycloak login + cube query; dev (`:3000`) still bypass.

## Risk Assessment
- **Risk:** centralizing identity silently changes a route's behavior. **Mitigation:** helper is additive (`req.principal`); existing `req.owner`/`req.user` untouched; golden suite catches drift.
- **Risk:** pre-provisioned email with no `users` row. **Mitigation:** `emailForSub` returns null; grant resolution stays email-keyed (already the case).
