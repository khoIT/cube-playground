---
phase: 5
title: "cube-dev Shared Authz Source"
status: pending
priority: P2
effort: "1d"
dependencies: [2]
---

# Phase 5: cube-dev Shared Authz Source

## Overview
Replace cube-dev's static `auth-users.json` with a lookup against the same authorization source the playground uses (its existing `TODO(prod)`), keyed consistently, so Cube's `checkAuth` enforces per-user game access for real users — the second half of closing the minted-path gap.

## Requirements
- Functional: `getUserAccess(userId)` returns the same allowed-games a user has in the app DB; a disallowed game 403s at Cube.
- Non-functional: bounded per-request cost (TTL cache, per the README hardening note); dev still works without prod auth DB (file fallback retained for local).

## Architecture
- Repo: `cube-dev` (sibling). Modify `cube/auth-db.js` `getUserAccess(userId)` to query the shared source instead of the JSON file.
- Two viable sources (decide at impl):
  - **A) Shared DB read** — query the playground's auth DB directly (`SELECT game_id FROM user_game_access WHERE email=?` + role). Requires the JWT `userId` to be a resolvable key (email or `sub`→email). Couples cube-dev to the app DB.
  - **B) Internal API** (preferred for decoupling) — playground exposes `GET /internal/access/:key` (service-to-service, shared secret), cube-dev calls it. Matches README's "auth service / internal API" wording.
- **Key contract** must match Phase 4's minted token: the playground mints Cube JWTs with `userId = <stable key>` (email or `sub`); cube-dev resolves that same key. Define once, shared with Phase 4.
- Add LRU/TTL cache (~60s) around the lookup (README hardening item). Keep the file-backed path as a local-dev fallback behind `AUTH_USERS_FILE`.

## Related Code Files
- Modify (cube-dev): `cube/auth-db.js` (`getUserAccess` → DB/API + cache; keep file fallback), `docker-compose.yml`/`.env.example` (new `AUTH_API_URL`/secret or DB DSN), `README.md` (update hardening note as done).
- Modify (cube-playground, if API path): create `server/src/routes/internal-access.ts` (`GET /internal/access/:key`, shared-secret guarded).
- Reference: `cube/cube.js` `checkAuth` (the `allowedGames.includes(game)` gate — unchanged, just fed by the new source), the `TODO(prod)` comment in `auth-db.js`.

## Implementation Steps
1. Decide source A vs B (recommend B — internal API, decoupled).
2. Implement the chosen lookup in `auth-db.js` with TTL cache; preserve file fallback for local dev.
3. If B: add the shared-secret internal endpoint in the playground returning `{allowedGames, role}` by key.
4. Align the `userId` key shape with Phase 4's minted Cube token.
5. Integration test: real user with PTG-only grant → PTG `/load` ok, ballistar `/load` 403 at Cube.

## Todo List
- [ ] choose source (A DB / B internal API — prefer B)
- [ ] auth-db.js → shared lookup + TTL cache + file fallback
- [ ] internal access endpoint (if B) with shared-secret
- [ ] userId key contract aligned with Phase 4
- [ ] cross-repo integration test (allowed vs denied game at Cube)

## Success Criteria
- [ ] cube-dev enforces per-user game access for real (non-`playground`) users.
- [ ] A PTG-only user is 403'd by Cube for a ballistar query.
- [ ] Local dev still runs without the prod auth source (file fallback).

## Risk Assessment
- **Cross-repo coupling + deploy ordering.** Mitigation: internal API (B) keeps a clean seam; ship behind a flag; the file fallback means cube-dev never hard-breaks if the API is down (degrade to deny or last-known per policy — choose deny for safety).
- **Latency per request** if no cache. Mitigation: mandatory TTL cache (README hardening item).

## Security Considerations
- Internal endpoint must be service-only (shared secret / network policy), never exposed to browsers.
- On lookup failure, fail **closed** (deny the game) rather than falling back to all-games.

## Open Question
- Confirm with `duongnt5`/devops whether prod intends a central auth-service DB; if so, source A/B should point there rather than the playground SQLite. (See plan-level open questions.)
