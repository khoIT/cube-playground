# Phase 05 — Guarded reseed (clearCases + reset route + button)

## Context links
- Brainstorm: `plans/reports/brainstorm-260609-1813-cs-demo-artifact-care-loop-report.md` (§Reseed, Open Q3)
- Plan overview: `plan.md` · Depends on Phase 01 (parallelizable with 02/03/04)

## Overview
- **Priority:** P3
- **Status:** pending
- **Description:** Make the demo re-runnable: new `clearCases(gameId, workspace)` store fn + guarded `POST /api/care/cases/reset?game` (editor/admin via existing gate, confirm dialog) → wipe the game's cases → optional re-sweep. Reset button in the queue UI.

## Key insights
- Only single-id `deleteCases(ids)` exists (`care-case-store.ts:203`) — no clear-all. Need `clearCases(gameId, workspace)` scoped to (game, workspace) so a reset never crosses game/workspace boundaries.
- `/api/care` POST already gates behind editor/admin (`enforce-write-roles.ts:21,40,48-66`) — the reset route inherits this; **no extra role code**. Confirm dialog is FE-only.
- Re-sweep path exists: `executeSweep(workspace, game, ctx, 'manual')` (`care-cases.ts:237`) — same executor the manual sweep + auto-cron use. `SweepBusyError` → 409 (`care-cases.ts:240`). Re-sweep must contend on the same per-(workspace,game) mutex (do not bypass).
- `requireGame(workspace, query)` validates `game` against the workspace allow-list + path-traversal guard (`care-cases.ts:52`). Reuse it.
- `cases` carry `workspace` column (`care-case-store.ts:21`); current `listCases`/delete are game-scoped but not workspace-scoped — `clearCases` must filter BOTH to avoid wiping another workspace's same-named game.

## Data flow
```
Reset button (editor/admin) ──► confirm dialog ("wipe N cases for <game>?")
  └─► POST /api/care/cases/reset?game=<g>[&resweep=true]
        ├─ requireGame → 400 if invalid
        ├─ clearCases(game, workspace.id) → deletedCount   (one transaction, game+workspace scoped)
        ├─ if resweep: executeSweep(workspace, game, ctx, 'manual')  (same mutex; 409 if busy)
        └─► { game, deleted, reswept?: {opened,lapsed,summaries} }
  └─► FE refetch queue + portfolio
```

## Requirements
**Functional**
1. `clearCases(gameId, workspace)` — delete all `care_cases` for (game_id, workspace) in one transaction; return deleted count. (Also clears profile snapshots? — No: leave `care_vip_profile` untouched unless re-sweep refreshes them. Document.)
2. `POST /api/care/cases/reset?game` — editor/admin (inherited gate); validate `game`; wipe; **optional** `?resweep=true` → run `executeSweep` after wipe (Open-Q3 default: optional via checkbox, NOT forced).
3. Returns `{game, deleted, reswept?}`; 409 if a sweep is in-flight when re-sweep requested (reuse `SweepBusyError`→409).
4. Reset button in queue UI behind `canWrite` + confirm dialog (count + game named); refetch on success.

**Non-functional:** tokens only (confirm dialog uses existing modal/button styles); no regression; reset is destructive → confirm mandatory.

## Architecture
- Store: add `clearCases(gameId, workspaceId)` next to `deleteCases` in `care-case-store.ts` (transactional, parameterized, game+workspace scoped).
- Route: add `POST /api/care/cases/reset` handler in `care-cases.ts` (small) — reuse `requireGame`, `executeSweep`, `SweepBusyError`, mirror the sweep route's error handling (`care-cases.ts:234-250`).
- FE: `resetCareCases(game, {resweep})` in `use-care-cases.ts` + Reset button + confirm dialog in `case-ledger.tsx` (reuse Phase-01/02 pending/error pattern).

## Related code files
**Create** — none (all additive to existing files).

**Modify**
- `server/src/care/care-case-store.ts` — add `clearCases(gameId, workspaceId): number`.
- `server/src/routes/care-cases.ts` — add `POST /api/care/cases/reset` handler.
- `server/test/care-case-ledger.test.ts` — store test for `clearCases` (scope isolation).
- `server/test/care-cases-route.test.ts` — route test: editor/admin only, game validation, wipe, optional re-sweep, 409 when busy.
- `src/pages/Dashboards/cs/use-care-cases.ts` — `resetCareCases(game, opts)` helper.
- `src/pages/Dashboards/cs/case-ledger.tsx` — Reset button + confirm dialog + refetch.

## Implementation steps
1. **TDD-first (store):** `care-case-ledger.test.ts` — `clearCases('cfm_vn', wsA)` deletes only cfm_vn/wsA cases; leaves other game AND other workspace's same-named game intact; returns count; empty → 0.
2. Implement `clearCases` (transactional, `WHERE game_id=? AND workspace=?`).
3. **TDD-first (route):** `care-cases-route.test.ts` — viewer → 403 (gate); editor → wipes + returns `{deleted}`; invalid game → 400; `?resweep=true` triggers `executeSweep` (mock/stub Cube ctx) and returns `reswept`; in-flight sweep → 409.
4. Implement `POST /api/care/cases/reset` (validate → clear → optional re-sweep, mirror sweep error handling).
5. FE `resetCareCases` + Reset button + confirm dialog (count + game) + `resweep` checkbox (OFF by default, per confirmed decision) + refetch.
7. tsc + server + FE suites green.

## Todo
- [ ] `care-case-ledger.test.ts` — `clearCases` scope isolation
- [ ] Implement `clearCases(gameId, workspaceId)`
- [ ] `care-cases-route.test.ts` — reset route (403/200/400/409 + resweep)
- [ ] Implement `POST /api/care/cases/reset`
- [ ] FE `resetCareCases` + Reset button + confirm dialog + `resweep` checkbox (off by default) + refetch
- [ ] tsc + suites green

## Success criteria
- Reset wipes only the target (game, workspace) cases; other workspaces/games untouched.
- Viewer blocked (403); editor/admin allowed via confirm.
- Optional re-sweep repopulates the queue; 409 if a sweep is running.
- Demo can be re-run cleanly. Existing suites green.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Cross-game / cross-workspace wipe | L×H | `WHERE game_id=? AND workspace=?`; `requireGame` allow-list; test isolation across both axes |
| Accidental destructive click | M×H | Mandatory confirm dialog naming game + count; `canWrite` gate |
| Re-sweep overlaps running sweep → races | M×M | Reuse same per-(workspace,game) mutex via `executeSweep`; 409 on `SweepBusyError` |
| Re-sweep needs live Cube; fails in demo | M×M | Make re-sweep optional; surface 502 like sweep route (`care-cases.ts:246`) |

## Security
- Inherits `/api/care` editor/admin write gate (`enforce-write-roles.ts:40`). Destructive op → confirm dialog. `game` validated against workspace allow-list; `workspace` scoping prevents cross-tenant wipe.

## Open questions
None — Q3 resolved: reset wipes only; `resweep` is an optional checkbox, OFF by default.

## Next steps
- Final phase. After this the loop is fully demoable + re-runnable. Update `docs/lessons-learned.md` if a non-trivial bug shape emerges (e.g. workspace-scope omission).
