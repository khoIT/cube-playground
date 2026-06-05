# Phase 02 — Access Store + AuthzSubject Shape

## Context Links
- Read path: `server/src/auth/access-store.ts:108-139` (`readAccess`), `:23-31` (`AccessRecord`)
- Mutators: `server/src/auth/access-store-mutators.ts:147-157` (`setGames`)
- Subject type: `server/src/auth/authz-decisions.ts:21-26` (`AuthzSubject`), `:42-46` (`userCanAccessGame`)
- AuthenticatedUser: `server/src/middleware/authenticate.ts:28-39`, `:131` (maps `access.games`)
- Cube bridge consumer: `server/src/routes/internal-access.ts:108-112`
- Auth payloads: `server/src/routes/auth.ts:121` (login), `:131-134` (`/me` returns `request.user`)
- Admin list type: `src/pages/Admin/access/use-admin-access.ts:13-22` (`AdminUser.games`)

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Replace flat `games: string[]` with `gamesByWorkspace: Record<string, string[]>`
  across the access store, AuthzSubject, AuthenticatedUser, and the auth payloads. Mutator becomes
  `setWorkspaceGames(email, workspaceId, gameIds)`.

## Key Insights
- `AccessRecord.games` (`:29`) flows to FOUR consumers: `authenticate.ts:131` (`allowedGames`),
  `auth.ts:121` (login payload), `internal-access.ts:110` (cube bridge), `listUsers` → admin UI.
  ALL must migrate together or the build breaks. Enumerate them (4 total, listed above).
- Cache is keyed by email and stores the whole `AccessRecord` (`access-store.ts:53,148-150`).
  Shape change is transparent to cache; TTL/invalidate logic unchanged.
- `setGames` is the ONLY game mutator; called from `admin-access.ts:77,110`. Both call sites change
  in Phase 04 — keep old `setGames` deleted (no dead code) once callers move.

## Requirements
- `AccessRecord.games: string[]` → `gamesByWorkspace: Record<string, string[]>`.
- `readAccess` SELECTs `workspace_id, game_id` and groups into the map.
- New mutator `setWorkspaceGames(email, workspaceId, gameIds)`: DELETE rows for that
  `(email, workspace_id)` only, INSERT the new set. Scoped delete — must NOT touch other workspaces.
- `AuthzSubject` + `AuthenticatedUser`: replace `allowedGames: string[]` with
  `gamesByWorkspace: Record<string, string[]>`. (Rename clarifies the shape changed.)

## Architecture
Read grouping:
```sql
SELECT workspace_id, game_id FROM user_game_access WHERE email = ?
```
→ reduce into `{ [workspace_id]: [game_id, …] }`.

Mutator (scoped replace):
```sql
DELETE FROM user_game_access WHERE email = ? AND workspace_id = ?;
INSERT OR IGNORE INTO user_game_access (email, workspace_id, game_id) VALUES (?, ?, ?);  -- per id
```
Wrapped in a transaction (mirror existing `setGames` tx pattern `:150-156`).

Payload shape (login + /me + AuthenticatedUser): emit `gamesByWorkspace`. FE consumes it in Phase 06.

## Related Code Files
- MODIFY: `server/src/auth/access-store.ts` (`AccessRecord`, `readAccess`)
- MODIFY: `server/src/auth/access-store-mutators.ts` (`setGames` → `setWorkspaceGames`)
- MODIFY: `server/src/auth/authz-decisions.ts` (`AuthzSubject.allowedGames` → `gamesByWorkspace`) — signature only here; logic in Phase 03
- MODIFY: `server/src/middleware/authenticate.ts` (`AuthenticatedUser`, devUser, `:131` mapping)
- MODIFY: `server/src/routes/auth.ts` (`:121` login payload, parity comment `:122-124`)
- MODIFY: `server/src/routes/internal-access.ts` (consumes `access.games` → flatten union, see Phase 03)
- MODIFY: `src/pages/Admin/access/use-admin-access.ts` (`AdminUser.games` → `gamesByWorkspace`) — FE type; full UI in Phase 05

## Implementation Steps
1. Change `AccessRecord`: drop `games`, add `gamesByWorkspace: Record<string, string[]>`.
2. Rewrite `readAccess` games query + group into map.
3. Replace `setGames` with `setWorkspaceGames(email, workspaceId, gameIds)` (scoped delete+insert).
4. Update `AuthzSubject` + `AuthenticatedUser` field (logic deferred to Phase 03 — keep compiling
   by having `userCanAccessGame` temporarily read the map; Phase 03 finalizes the signature).
5. Update `devUser()` (`authenticate.ts:69-91`): synthesize `gamesByWorkspace` = all games for
   every registry workspace, OR an empty map that the decision fn treats as unrestricted under
   AUTH_DISABLED. RECOMMEND: keep devUser permissive — empty map + AUTH_DISABLED short-circuit in
   the decision fn (Phase 03) so the dev loop never fails closed. Confirm in Phase 03.
6. Update login (`auth.ts:121`) + `/me` payloads to emit `gamesByWorkspace`.
7. Update `AdminUser` FE type (`use-admin-access.ts`) to match list payload.

## Todo
- [ ] `AccessRecord.gamesByWorkspace` + `readAccess` grouping
- [ ] `setWorkspaceGames` mutator (scoped delete+insert, tx)
- [ ] Delete old `setGames` once callers move (Phase 04)
- [ ] `AuthzSubject` + `AuthenticatedUser` field rename
- [ ] `devUser()` shape (permissive, dev loop intact)
- [ ] login + /me payloads emit `gamesByWorkspace`
- [ ] `AdminUser` FE type updated
- [ ] `npm run build` (server + FE) clean

## Success Criteria
- `readAccess` returns `gamesByWorkspace` grouped correctly (verify in Phase 07 store test).
- `setWorkspaceGames('u','ws-a',['g1'])` does NOT remove `(u,'ws-b','g2')`.
- Server + FE both typecheck.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Missed consumer of `.games` → compile error | Med | Low | 4 consumers enumerated above; grep `\.games\b` + `allowedGames` post-edit |
| devUser turns fail-closed → breaks dev | Med | High | Phase 03 AUTH_DISABLED short-circuit; explicit test |

## Security Considerations
- Scoped delete prevents cross-workspace grant wipe (data-integrity).
- Payload now leaks per-workspace structure to FE — acceptable (FE already sees flat list).

## Next Steps
- Unblocks Phase 03 (decision fn signature) + Phase 04 (admin API) + Phase 06 (FE picker).
