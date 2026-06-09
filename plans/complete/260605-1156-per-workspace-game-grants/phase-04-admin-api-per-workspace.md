# Phase 04 — Admin API (Per-Workspace Set-Games)

## Context Links
- Routes: `server/src/routes/admin-access.ts:106-113` (`PUT …/games`), `:60-80` (`POST /users`),
  `:54-58` (`GET /registry`)
- Mutator (new): `setWorkspaceGames` (Phase 02)
- Audit: `recordAccessAudit` (`access-audit-store.ts`), called per mutation

## Overview
- **Priority:** P1
- **Status:** pending
- **Description:** Replace the global `PUT /api/admin/users/:email/games` with a per-workspace
  endpoint. Update `POST /api/admin/users` create body. Keep every mutation audited. Extend
  `/api/admin/registry` so the UI can render per-workspace available games.

## Key Insights
- `setGames` is called from TWO sites in this file: `:77` (create) and `:110` (PUT). Both move to
  `setWorkspaceGames` and must carry a workspace id.
- `GET /api/admin/registry` (`:54-58`) returns flat `games[]`. The per-workspace matrix UI needs to
  know WHICH games are available per workspace (prefix workspaces expose only `gamePrefixMap` keys).
  Two options (see Decision).

## DECISION — endpoint shape
**Chosen: path-scoped `PUT /api/admin/users/:email/workspaces/:wsId/games` with body `{ gameIds }`.**
Rationale: RESTful, mirrors the existing `/workspaces` and `/features` sub-resource pattern
(`:97,:115`); the workspace id is a first-class path segment (auditable, cache-friendly), and avoids
overloading the existing `/games` route body. The alternative (extend body with `workspaceId`) is
less discoverable and mixes scope into the payload. **Justified: path-scoped.**

Create-user body (`POST /users`): change `gameIds?: string[]` →
`gamesByWorkspace?: Record<string, string[]>` so pre-provisioning can seed per-workspace grants in
one call. Apply each entry via `setWorkspaceGames`.

## Requirements
- NEW route `PUT /api/admin/users/:email/workspaces/:wsId/games` body `{ gameIds: string[] }` →
  `setWorkspaceGames(email, wsId, gameIds)` + audit (`action: 'set_workspace_games'`, detail includes wsId).
- REMOVE old `PUT …/games` (`:106-113`) — no dead route.
- `POST /users` create body: `gamesByWorkspace?: Record<string, string[]>`; loop + `setWorkspaceGames`.
- `GET /registry`: add per-workspace available-games so UI can scope the matrix. Add
  `gamesByWorkspace: Record<wsId, string[]>` computed from each workspace's exposure (prefix → `gamePrefixMap`
  keys mapped to gds ids; game_id model → all gds games). Reuse the same availability logic the FE
  picker uses (gamePrefixMap) — keep DRY by extracting if it already exists in workspaces-config-loader.
- Validate `wsId` against the registry (400 on unknown) — mirror `workspace-header.ts` unknown-ws 400.

## Architecture
```
Admin UI ─ PUT /users/:email/workspaces/:wsId/games {gameIds}
              ▼ validate wsId ∈ registry, validate gameIds
              setWorkspaceGames(email, wsId, gameIds)   (scoped delete+insert)
              recordAccessAudit({action:'set_workspace_games', target, detail:{wsId, gameIds}})
```
Registry response gains per-workspace available game ids so the UI never offers a game a workspace
can't expose (prevents granting `cros` in a workspace whose prefixMap lacks it).

## Related Code Files
- MODIFY: `server/src/routes/admin-access.ts` (new route, remove old, create-body, registry shape)
- READ: `server/src/services/workspaces-config-loader.ts` (workspace defs, gamePrefixMap, listWorkspacesPublic)
- READ: `server/src/services/workspace-readiness.ts` (optional — if matrix should reflect readiness; KISS: registry availability is enough, readiness is a Phase-06 picker concern)

## Implementation Steps
1. Add zod `wsGameIdsBody = z.object({ gameIds: z.array(z.string()) })` (reuse existing `gameIdsBody`).
2. Add `PUT /api/admin/users/:email/workspaces/:wsId/games`: validate wsId ∈ registry (400 if not),
   `setWorkspaceGames`, audit with wsId in detail.
3. Remove old `PUT …/games` route + its `gameIdsBody` if now unused.
4. Update `createBody`: `gameIds` → `gamesByWorkspace` (`z.record(z.array(z.string()))`); in handler
   loop entries → `setWorkspaceGames`.
5. Extend `/registry` response with `gamesByWorkspace` availability map (compute per workspace).
6. Confirm router-scope `requireRole('admin')` + `requireFeature('admin')` still apply (`:46-47`) — yes, hooks are router-wide.

## Todo
- [ ] New per-workspace PUT route + wsId validation + audit
- [ ] Remove old global `/games` route
- [ ] `POST /users` create body → `gamesByWorkspace`
- [ ] `/registry` returns per-workspace available games
- [ ] Build clean; admin-access-api.test updated (Phase 07)

## Success Criteria
- `PUT /users/u/workspaces/ws-a/games {gameIds:['g1']}` persists only ws-a; ws-b untouched.
- Unknown wsId → 400.
- Every mutation produces an audit row with the wsId in detail.
- `/registry` lists, per workspace, only games that workspace can expose.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| UI offers a game a workspace can't expose | Med | Low | Registry per-ws availability; server doesn't reject (grant is harmless if game never resolves) — but validate gameIds non-empty strings |
| Old route still referenced by FE | Med | Med | Phase 05 updates `use-admin-access.ts` in lockstep; grep `/games'` |

## Security Considerations
- Router-scope admin gate unchanged. Audit every mutation incl. wsId (traceability).
- wsId path validation prevents writing grants for non-existent workspaces (junk rows).

## Next Steps
- Unblocks Phase 05 (UI), Phase 07 (route tests).
