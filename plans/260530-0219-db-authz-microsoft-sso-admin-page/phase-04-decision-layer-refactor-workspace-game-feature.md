---
phase: 4
title: "Decision-Layer Refactor (Workspace/Game/Feature)"
status: pending
priority: P1
effort: "2d"
dependencies: [2, 3]
---

# Phase 4: Decision-Layer Refactor (Workspace/Game/Feature)

## Overview
Make all three access gates read the DB grants. Workspace gate goes from per-role-config to per-user grants; game access is enforced server-side (closing the minted-path FE-only gap); feature gating becomes a real server-checked capability instead of localStorage cosmetics.

## Requirements
- Functional: a user can only reach workspaces/games/features they're granted; gates fail closed.
- Non-functional: keep static `workspaces.config.json`/`gds.config.json` as the *registry* of what exists; the DB decides *who* gets what. No regression for `AUTH_DISABLED` dev (synth admin → all).

## Architecture
- **Workspace gate** (`middleware/workspace-header.ts` + `workspaces-config-loader.ts`): replace `workspaceAllowsRole(ws, role)` with `userCanAccessWorkspace(email, ws)` = grant in `user_workspace_access` (fallback: if a workspace has `allowedRoles` and no per-user rows exist yet, honor role — eases migration; remove fallback once grants are populated). Keep `403 WORKSPACE_FORBIDDEN`.
- **Game access (server-enforced)** — the important fix:
  - New `GET /api/games` returns the games the user may see = registry (`gds.config.json` ∩ workspace `gamePrefixMap`) ∩ `user_game_access`. FE `use-game-context.ts` consumes this instead of the dropped JWT claim.
  - Close the minted-path gap: when minting the Cube token for a request (`resolve-cube-token.ts` / `workspace-header.ts` `buildCtx`), gate the requested `x-cube-game` against `user_game_access(email)` and mint a JWT whose `userId` reflects the *real* user (not blanket `playground`) so cube-dev's `checkAuth` (Phase 5) enforces it too. Reject disallowed game with 403 before proxying.
- **Feature gate**: new `requireFeature(key)` preHandler for server routes that are feature-scoped; `GET /api/me/features` (or extend `/api/auth/me`) returns the user's resolved feature map. FE `use-visible-nav-items.ts` keeps localStorage for *cosmetic* hide, but nav/route mount now also respects the server feature map (enforced, not cosmetic). Hard-deny at route level for ungranted features.

## Related Code Files
- Modify: `server/src/middleware/workspace-header.ts`, `server/src/services/workspaces-config-loader.ts`, `server/src/services/resolve-cube-token.ts`
- Create: `server/src/routes/games.ts` (`GET /api/games`), feature map on `/api/auth/me`
- Create: `server/src/middleware/require-feature.ts`
- Modify (FE): `src/components/Header/use-game-context.ts` (consume `/api/games`), `src/auth/auth-context.tsx` (carry feature map), `src/shell/sidebar/*` + route guards (enforce features), `src/pages/Settings/use-visible-nav-items.ts` (cosmetic-only, layered under enforcement)
- Reference: prior fix — `x-cube-game` header now sent on all `/meta` fetches (already shipped).

## Implementation Steps
1. Workspace gate → per-user grant check with role fallback flag.
2. `GET /api/games`; switch FE game context off the dropped claim onto the API.
3. Minted-path: gate `x-cube-game` against `user_game_access`; mint real-user `userId` claim; 403 on disallowed game.
4. `require-feature` preHandler + feature map endpoint; apply to feature-scoped routes.
5. FE: enforce feature map at nav/route mount; keep localStorage as cosmetic layer only.
6. Tests: each gate fails closed; granted passes; dev-mode synth admin unaffected.

## Todo List
- [ ] workspace gate → per-user grants (role fallback flag)
- [ ] GET /api/games + FE consumption
- [ ] server-side game enforcement on minted path (real userId claim)
- [ ] require-feature preHandler + feature map endpoint
- [ ] FE feature enforcement (not cosmetic)
- [ ] fail-closed gate tests (all 3 dimensions)

## Success Criteria
- [ ] Disallowed workspace/game/feature → 403, both API and UI.
- [ ] Game access is enforced server-side even via crafted requests (no FE-only gap).
- [ ] `/api/games` drives the switcher; no reliance on a client JWT game claim.
- [ ] Dev `AUTH_DISABLED` still sees everything.

## Risk Assessment
- **Minted-token rework is the trickiest bit** (Phase 5 in cube-dev must agree on the `userId` claim shape). Mitigation: define the claim contract once, shared with Phase 5; integration test through the proxy (lesson: test through :3004, not just :3005).
- **Over-broad role fallback** could mask missing grants. Mitigation: fallback is a temporary, logged flag; Phase 8 flips it off after grants seeded.

## Security Considerations
- Gates must fail **closed** (deny on missing/ambiguous grant), never open.
- Re-validate game on the server per request; never rely on the FE having hidden it.
