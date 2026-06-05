# Phase 06 — FE Picker (Active-Workspace Grants)

## Context Links
- Picker: `src/components/Header/use-game-context.ts:206-232` (`visibleGames`), `:222-225`
  (current flat `allowedGames` narrowing)
- Auth user: `src/auth/auth-context.tsx:36-48` (`AuthUser`), `:246-250` (`useAuthUser`)
- Workspace tracking: `use-game-context.ts:93-100` (`workspaceId`, `workspaces`), `:206-209` (`activeWorkspace`)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** The picker narrows visible games by the ACTIVE workspace's granted games
  (fail-closed: empty grant → empty picker). Consume the new `gamesByWorkspace` payload shape.

## Key Insights
- `use-game-context.ts` ALREADY tracks the active `workspaceId` (`:93-100,:159-162`) — the data it
  needs for per-workspace narrowing is in scope. The only change is the narrowing predicate at
  `:222-225`.
- Current logic: `if (authUser && authUser.allowedGames.length > 0)` narrows by a flat list, and
  EMPTY means "don't narrow" (`:219-221` comment). Under fail-closed per-workspace, EMPTY must mean
  EMPTY PICKER for a real user — a semantic INVERSION. Must distinguish:
  - dev/synthesized user (AUTH_DISABLED) → never narrow (dev loop).
  - real user → narrow by `gamesByWorkspace[activeWorkspaceId] ?? []`; empty/absent ⇒ NO games.
- How to tell dev from real on the FE: AuthState is `'disabled'` for AUTH_DISABLED
  (`auth-context.tsx:61,159`) vs `'authenticated'` for real. `useAuthUser` collapses both to the user
  object (`:246-250`). Need to surface the mode. Options:
  - **Recommended:** add a flag to the picker's auth read — expose `isRealAuth` (state==='authenticated')
    via a small selector, OR check a payload marker. KISS: have the picker read `useAuth().state.status`
    and only fail-closed when `status === 'authenticated'`. When `'disabled'`, pass-through.
- The picker also intersects workspace-availability (prefix `gamePrefixMap`) and `readyGameIds`
  (`:213-230`). Per-workspace grant narrowing is an ADDITIONAL intersection, applied for real auth only.

## Requirements
- `AuthUser.allowedGames: string[]` → `gamesByWorkspace: Record<string, string[]>` (mirror server).
- Picker narrowing (real-auth only): `pool = pool.filter(g => grantedHere.includes(g.id))` where
  `grantedHere = authUser.gamesByWorkspace[activeWorkspaceId] ?? []`. Empty ⇒ empty pool (fail-closed).
- AUTH_DISABLED (`status==='disabled'`): NO grant narrowing (pass-through) — preserves dev loop.
- Active-game fallback effect (`:237-243`) still picks first visible; empty visible ⇒ no active game
  (acceptable; surfaces "no games" state — verify GamePicker renders gracefully with 0 games).

## Architecture
```
visibleGames (real auth):
  config.games
   ∩ workspace-available (gamePrefixMap for prefix)        (:213-218)
   ∩ gamesByWorkspace[activeWorkspaceId]   ← NEW, fail-closed
   ∩ readyGameIds (if loaded)                              (:228-230)
```
The grant intersection must key off `workspaceId` (the picker's tracked active ws), NOT
`activeWorkspace.id` only — but they're the same value; use the tracked `workspaceId` to avoid a
null `activeWorkspace` during registry load. If `workspaceId` not yet resolved → pass-through (don't
flash-empty on first paint), THEN apply once resolved. Mirror the existing `readyGameIds` null-guard.

## Related Code Files
- MODIFY: `src/auth/auth-context.tsx` (`AuthUser.allowedGames` → `gamesByWorkspace`)
- MODIFY: `src/components/Header/use-game-context.ts` (narrowing predicate, real-auth guard)
- VERIFY: other `allowedGames` FE consumers — `src/pages/Data/triage/view-builder.tsx:236`
  (`user?.allowedGames ?? []`) and `cross-game-join-panel.tsx`. These use the flat list for
  cross-game JOIN targets. Decide: flatten `gamesByWorkspace` to a union for that consumer, or scope
  to active ws. RECOMMEND union (cross-game join is inherently multi-game) — minimal change, keep a
  helper `allGamesUnion(user)`. ENUMERATE both consumers (2 total) in the edit.

## Implementation Steps
1. Update `AuthUser` type → `gamesByWorkspace`.
2. In `use-game-context.ts`, replace `:222-225` block: compute `grantedHere` from active ws; apply
   fail-closed only when real auth. Add `useAuth().state.status` read (or a derived `isRealAuth`).
3. Guard first-paint: if `workspaceId` empty/unresolved → skip grant narrowing (pass-through).
4. Fix the 2 other `allowedGames` consumers (view-builder, cross-game-join-panel) via a union helper.
5. Verify GamePicker + dependent surfaces render with 0 visible games (empty-state, no crash).

## Todo
- [ ] `AuthUser.gamesByWorkspace` type
- [ ] Picker narrowing: active-ws grant, fail-closed, real-auth-only
- [ ] First-paint pass-through guard (unresolved workspaceId)
- [ ] Fix view-builder + cross-game-join-panel (union helper, 2 consumers)
- [ ] 0-games empty state verified
- [ ] FE build + vitest clean

## Success Criteria
- Real user granted `[g1]` in active ws-a: picker shows only g1.
- Real user with empty grant in active ws: picker EMPTY.
- Switching active workspace re-narrows to that ws's grant.
- AUTH_DISABLED dev: all games (pass-through), unchanged.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Empty-grant inversion flashes empty on first paint | Med | Med | Pass-through until workspaceId resolves |
| 0 games crashes GamePicker / downstream | Med | Med | Verify empty-state; mirror FALLBACK_GAME guard |
| Missed allowedGames consumer | Low | Med | 2 enumerated (view-builder:236, cross-game-join-panel); grep post-edit |

## Security Considerations
- FE narrowing is UX only — server (Phase 03) is authoritative. A user who edits client state still
  hits the 403 at `workspace-header.ts`.

## Next Steps
- Unblocks Phase 07 (FE picker test).
