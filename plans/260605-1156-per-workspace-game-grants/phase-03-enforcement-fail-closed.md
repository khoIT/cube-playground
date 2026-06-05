# Phase 03 — Enforcement (Decision Fns + Middleware + Cube Bridge)

## Context Links
- Decision fns: `server/src/auth/authz-decisions.ts:42-46` (`userCanAccessGame`), `:28-31` (`grantFallbackEnabled`)
- Request gate: `server/src/middleware/workspace-header.ts:117` (`req.workspace` set), `:122-131` (game check)
- Cube bridge: `server/src/routes/internal-access.ts:55-59` (`allowedGamesFor`), `:108-112`
- devUser: `server/src/middleware/authenticate.ts:69-91`

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** `userCanAccessGame` becomes per-workspace and FAIL-CLOSED (Locked Decision 2).
  Update `workspace-header.ts` to pass `req.workspace.id`. Reconcile the cube-dev bridge
  (`internal-access.ts`) which has no workspace context. Keep AUTH_DISABLED dev loop working.

## Key Insights
- `workspace-header.ts:117` sets `request.workspace` BEFORE the game check at `:123`. The workspace
  IS already resolved — the current `userCanAccessGame(user, gameId)` simply ignores it. Passing
  `req.workspace.id` is a one-line plumbing change; the workspace is in scope. **Verified by trace:**
  `resolveWorkspace` → `request.workspace = workspace` (`:88,117`) → game check (`:123`).
- **THREE enforcement surfaces** (only #1 sees the workspace):
  1. `workspace-header.ts` server gate — authoritative per-workspace check. WORKSPACE KNOWN.
  2. FE picker (Phase 06) — UX only, never trusted for security.
  3. `internal-access.ts` cube-dev `checkAuth` bridge — keyed by EMAIL ONLY (cube JWT userId),
     answers a per-email lookup with NO request/workspace context. CANNOT be per-workspace.
- Surface 3 is defense-in-depth (cube-dev double-checks the minted token). Because it can't know
  the workspace, it must emit a workspace-AGNOSTIC allow-set = UNION of the user's per-workspace
  game grants. The PRIMARY per-workspace gate is surface 1; the union at surface 3 only prevents a
  user from querying a game they hold in NO workspace. This is acceptable: surface 1 already blocked
  the wrong-workspace case before any cube token is minted (`:122-131` runs pre-mint).

## DECISIONS (need user confirmation — see Open Questions)
**D1 — Fail-closed semantics.** RECOMMEND: per-workspace fail-closed ALWAYS for a real user.
`userCanAccessGame(subject, workspaceId, gameId)`:
- If `AUTH_DISABLED` dev (subject is devUser): allow (short-circuit — never strand dev loop).
- Else look up `subject.gamesByWorkspace[workspaceId]`:
  - present & non-empty → `includes(gameId)`.
  - present & empty OR absent → check `grantFallbackEnabled()`:
    - **Recommended fallback rule:** fallback applies ONLY when the user has NO game grants in ANY
      workspace (`Object.keys(gamesByWorkspace).length === 0`) → migration-ease allow. If the user
      has grants in SOME workspace but none in THIS workspace → FAIL CLOSED even with fallback on.
      This matches the existing authz-decisions doctrine ("a user who DOES have grants is always
      checked against them") at `authz-decisions.ts:8-12`.
  - fallback off → deny.

**D2 — Cube bridge union.** `allowedGamesFor` in `internal-access.ts` flattens
`gamesByWorkspace` to a unique union. Admin → `['*']` (unchanged). No-grants + fallback → `['*']`
(unchanged). Else union of all per-workspace games, canonicalized (`canonicalGameId`, `:43-45`).

## Requirements
- `userCanAccessGame(subject, workspaceId, gameId)` — 3-arg, fail-closed per D1.
- `workspace-header.ts:123` passes `req.workspace.id`.
- devUser path never fails closed (AUTH_DISABLED short-circuit in the decision fn OR devUser carries
  an all-games map). RECOMMEND: short-circuit on an explicit dev marker is brittle; instead have the
  decision fn treat `AUTH_DISABLED` via a small helper, OR (simpler, no env coupling in the pure fn)
  give devUser a `gamesByWorkspace` populated with all games for every registry workspace + keep the
  "no grants anywhere → fallback allow" branch. **Pick the devUser-populated approach** to keep the
  decision fn pure (no env reads) — matches existing devUser pattern (`authenticate.ts:73-79`).
- `internal-access.ts allowedGamesFor` consumes `gamesByWorkspace` (union per D2).

## Architecture
```
request ─▶ workspace-header onRequest
            ├─ resolve req.workspace            (:88,117)
            ├─ userCanAccessWorkspace            (:107)  ← unchanged
            └─ userCanAccessGame(user, req.workspace.id, gameId)  (:123)  ← FAIL-CLOSED
                  ▼ 403 GAME_FORBIDDEN before token mint

cube-dev checkAuth ─▶ GET /internal/access/:email
            └─ allowedGamesFor(role, gamesByWorkspace)  ← union (defense-in-depth)
```

## Related Code Files
- MODIFY: `server/src/auth/authz-decisions.ts` (`userCanAccessGame` 3-arg, fail-closed)
- MODIFY: `server/src/middleware/workspace-header.ts:123` (pass `req.workspace.id`)
- MODIFY: `server/src/routes/internal-access.ts` (`allowedGamesFor` union over map)
- MODIFY: `server/src/middleware/authenticate.ts` devUser (all-games map per workspace)

## Implementation Steps
1. Rewrite `userCanAccessGame` to 3-arg per D1. Comment explains fail-closed + no-grants-anywhere
   fallback (explain the WHY — per-workspace isolation — no plan refs).
2. Update the single call site `workspace-header.ts:123` to pass `req.workspace.id`.
3. devUser: build `gamesByWorkspace` from registry workspaces × all gds.config games (reuse
   `loadGamesConfig` already imported `:23`; load workspace ids from registry loader). Keep the
   try/catch graceful-empty pattern.
4. `allowedGamesFor`: accept `gamesByWorkspace`, flatten to unique canonical union; preserve admin
   `['*']` and no-grants+fallback `['*']` branches.
5. Grep for any OTHER caller of `userCanAccessGame` (verified: ONLY `workspace-header.ts:123` — 1
   call site total). Confirm post-edit.

## Todo
- [ ] `userCanAccessGame(subject, workspaceId, gameId)` fail-closed (D1)
- [ ] `workspace-header.ts:123` passes `req.workspace.id`
- [ ] devUser all-games-per-workspace map (dev loop intact)
- [ ] `allowedGamesFor` union over `gamesByWorkspace` (D2)
- [ ] Confirm sole call site; grep `userCanAccessGame`
- [ ] Server build clean

## Success Criteria
- Real user granted `[g1]` in `ws-a`, nothing in `ws-b`: allowed g1 in ws-a, DENIED g1 in ws-b.
- Real user with NO grants anywhere + fallback ON: allowed (migration ease).
- Real user with grants in ws-a only, requesting ws-b + fallback ON: DENIED (partial-grant fail-closed).
- AUTH_DISABLED dev: all games in all workspaces (dev loop unbroken).
- Cube bridge returns union of per-workspace games for a non-admin.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bridge union over-grants vs surface-1 | Med | Low | Surface 1 is authoritative + pre-mint; bridge is 2nd layer only — documented |
| devUser fail-closed strands dev | Med | High | All-games map; explicit Phase 07 test under AUTH_DISABLED |
| Fallback semantics misread → mass lockout on deploy | Low | High | Backfill (P1) + no-grants-anywhere fallback both cover; staged rollout |

## Security Considerations
- Pre-mint 403 (`:122-131`) means a forbidden game never gets a Cube token — no data path opens.
- Bridge union is strictly ≥ any single workspace's grant, but surface 1 already gated the workspace,
  so net access = intersection of (surface 1 per-ws) ∩ (surface 3 union) = surface 1. Safe.

## Next Steps
- Unblocks Phase 07 (enforcement tests).
- AUTHZ_GRANT_FALLBACK final flip-off stays an ops step (existing "Phase 8 endgame", out of scope here).
