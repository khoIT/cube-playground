# Phase 05 — Admin UI (Workspace → Games Matrix)

## Context Links
- Editor: `src/pages/Admin/access/access-editor.tsx:36,102-107` (Games GrantMatrix)
- Matrix component: `src/pages/Admin/access/grant-matrix.tsx` (reusable, controlled)
- Section hook: `src/pages/Admin/access/use-grant-section.ts`
- Data hooks: `src/pages/Admin/access/use-admin-access.ts:106-111` (`putAdminUserGames`),
  `:24-28` (`AdminRegistry`), `:13-22` (`AdminUser`)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** Replace the single global Games matrix with a per-workspace games picker: admin
  picks a workspace, sees that workspace's available games, grants a subset. Saves to the new
  per-workspace endpoint.

## Key Insights
- The Games matrix today (`access-editor.tsx:102-107`) is one flat `GrantMatrix` bound to
  `user.games` via `useGrantSection` + `putAdminUserGames`. It becomes workspace-scoped.
- `GrantMatrix` + `useGrantSection` are reusable and need NO change — only the wiring changes.
- The user's granted workspaces are already in `user.workspaces` (the Workspaces matrix). The games
  picker should only offer workspaces the user is granted (granting games in an ungranted workspace
  is dead data — KISS: scope the workspace selector to `user.workspaces`).
- Registry now carries per-workspace available games (Phase 04) → feed the matrix `options`.

## Requirements
- A workspace selector (dropdown or pill row) listing the user's GRANTED workspaces (`user.workspaces`
  ∩ `registry.workspaces`). Empty → "Grant a workspace first" hint.
- For the selected workspace: a `GrantMatrix` whose `options` = `registry.gamesByWorkspace[wsId]`
  (available games for that workspace), `selected` = `user.gamesByWorkspace[wsId] ?? []`.
- Save → `putAdminUserWorkspaceGames(email, wsId, gameIds)` (new hook), then refetch row.
- Empty selection saved = explicit empty grant = fail-closed (allowed, intentional per Locked Decision 2).

## Architecture
```
AccessEditor
 ├─ Workspaces GrantMatrix          (unchanged)
 ├─ Per-Workspace Games
 │    ├─ workspace selector  ← user.workspaces
 │    └─ GrantMatrix (per selected ws)
 │         options  = registry.gamesByWorkspace[wsId]
 │         selected = user.gamesByWorkspace[wsId]
 │         onSave   = putAdminUserWorkspaceGames(email, wsId, ids)
 └─ Features GrantMatrix             (unchanged)
```
Use one `useGrantSection` instance keyed by the selected wsId (remount via `key={wsId}` so the
section resyncs its selection when the admin switches workspace — `useGrantSection` already resyncs
on `granted` change `:35-41`, but a `key` remount is the cleanest reset).

## Related Code Files
- MODIFY: `src/pages/Admin/access/access-editor.tsx` (replace flat Games section)
- MODIFY: `src/pages/Admin/access/use-admin-access.ts` (`AdminUser.gamesByWorkspace`,
  `AdminRegistry.gamesByWorkspace`, new `putAdminUserWorkspaceGames`, update `createAdminUser` body type)
- POSSIBLY NEW: `src/pages/Admin/access/workspace-games-section.tsx` (extract the selector + matrix
  if `access-editor.tsx` exceeds ~150 LOC after change — keep <200 LOC rule)
- READ: `grant-matrix.tsx`, `use-grant-section.ts` (no change)

## Implementation Steps
1. Update `use-admin-access.ts`: `AdminUser.games` → `gamesByWorkspace`; `AdminRegistry` gains
   `gamesByWorkspace`; replace `putAdminUserGames` with `putAdminUserWorkspaceGames(email, wsId, ids)`
   hitting `PUT …/workspaces/:wsId/games`; update `CreateUserBody`.
2. In `access-editor.tsx`, replace the Games `GrantMatrix` block with a workspace selector +
   per-ws matrix. Default the selector to the first granted workspace.
3. If file grows past ~150 LOC, extract `workspace-games-section.tsx`.
4. Follow design tokens (`grant-matrix.tsx` already uses them — reuse the component verbatim).
   Selector styled like the existing `select` in `access-editor.tsx:134-139`.
5. Pre-provision form (`pre-provision-form.tsx`): if it sends `gameIds`, update to `gamesByWorkspace`
   or drop game seeding from create (KISS — admin can grant per-ws after create). VERIFY its current
   shape before editing.

## Todo
- [ ] `use-admin-access.ts` types + `putAdminUserWorkspaceGames` + create body
- [ ] Workspace selector scoped to `user.workspaces`
- [ ] Per-ws `GrantMatrix` (options from registry.gamesByWorkspace, key={wsId})
- [ ] Extract `workspace-games-section.tsx` if >150 LOC
- [ ] Reconcile `pre-provision-form.tsx`
- [ ] Design-token cross-check vs adjacent admin panels
- [ ] FE build + vitest clean

## Success Criteria
- Selecting ws-a shows only ws-a's available games; toggling + Save persists to ws-a only.
- Switching to ws-b shows ws-b's own (independent) selection.
- User with no granted workspaces sees the "grant a workspace first" hint, no matrix.
- Saving an empty set persists empty (fail-closed) without error.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stale selection when switching ws | Med | Low | `key={wsId}` remount + useGrantSection resync |
| `pre-provision-form` still posts `gameIds` → 400 | Med | Med | Step 5 reconcile; grep `gameIds` under src/pages/Admin |
| access-editor >200 LOC | Med | Low | Extract section component |

## Security Considerations
- UI is convenience only; server (Phase 03/04) is authoritative. No trust placed in FE filtering.

## Next Steps
- Unblocks Phase 07 (FE admin UI test).
