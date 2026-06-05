# Phase 03 — Pre-agg readiness panel (Settings FE)

## Context Links
- `src/pages/Settings/workspace-readiness-section.tsx` (panel layout, `Cell`/`Grid`/`StatRow` styled comps, `gameTone`)
- `src/pages/Settings/use-workspace-readiness.ts` (report type mirror, `apiFetch`)
- `docs/design-guidelines.md` (tokens — mandatory)
- Blocked by: Phase 02 (response shape)

## Overview
- **Priority:** P2
- **Status:** completed
- **Description:** Render the new `preaggs` section in the Workspace readiness tab,
  reusing the existing `Cell`/`Grid` tone system. Per game show a `built / unbuilt /
  error` summary; for `game_id` workspaces only (hide for prefix with a one-line note).

## Key Insights
- The section component already owns all styled primitives — reuse `Cell` with tones
  (`ok`=built, `warn`=unbuilt, `bad`=error, `mute`=n/a). No new bespoke styling.
- Mirror the `preaggs` types into `use-workspace-readiness.ts`'s
  `WorkspaceReadinessReport` (the hook hand-mirrors server types — keep in sync).
- Design tokens only: `var(--success-soft/-ink)`, `var(--warning-soft/-ink)`,
  `var(--destructive-soft/-ink)`, `var(--bg-muted)`. No raw hex.

## Requirements
**Functional**
- New `SectionCard` "Pre-aggregation status" between "Game availability" and
  "Your artifacts". Per game: a `Cell` showing `<built> built · <unbuilt> unbuilt`
  with `bad` tone when any errored.
- For non-game_id workspaces: render a single muted hint ("Pre-agg status is only
  tracked for the in-stack local workspace") instead of the grid.
**Non-functional**
- Refetch piggybacks on the existing readiness fetch + Refresh button (no separate call).

## Related Code Files
**Modify**
- `src/pages/Settings/use-workspace-readiness.ts` — add `PreaggCubeStatus`,
  `PreaggGame`, `PreaggReadiness` types + `preaggs` on `WorkspaceReadinessReport`.
- `src/pages/Settings/workspace-readiness-section.tsx` — add the panel + a
  `preaggTone` helper; render after the Game availability card.

## Implementation Steps
1. Add types to the hook mirroring P02's server shape exactly:
   `{ games: { id, label, cubes: { cube, status: 'built'|'unbuilt'|'error', message? }[], built, unbuilt, errored }[], generatedAt }`
   plus an optional `note` for the n/a case.
2. Add `preaggTone(g)`: errored>0 → `bad`; unbuilt>0 → `warn`; all built → `ok`;
   no cubes → `mute`.
3. Add the `SectionCard`: if `workspace.gameModel !== 'game_id'` render the muted
   hint; else `Grid` of `Cell`s, label = game, right-aligned count
   `${built}/${built+unbuilt+errored} built`, `.sub` lists errored cube names if any.
4. Test (`src/pages/Settings/__tests__/workspace-readiness-section.test.tsx` — create
   or extend): render with a fixture report containing built+unbuilt+error cubes,
   assert tones + counts; render a prefix workspace, assert the n/a hint shows and no grid.

## Todo List
- [x] mirror `preaggs` types in the hook
- [x] `preaggTone` helper
- [x] Pre-aggregation status `SectionCard` (game_id grid + prefix n/a hint)
- [x] vitest render test (tones, counts, n/a path)
- [x] tokens only — cross-check against Game availability card

## Success Criteria
- Panel shows per-game built/unbuilt/error using existing tone tokens.
- Prefix workspace shows the n/a hint, issues no extra fetch.
- Visual parity with adjacent "Game availability" card (same Cell/Grid).
- Test passes.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Type drift between hook mirror and server | M×L | Keep both shapes in PR diff; test fixture matches server type |
| Panel implies prod has pre-aggs (it doesn't track them) | L×M | Explicit n/a hint for non-game_id |

## Rollback
Remove the panel + types; readiness tab reverts to prior 3 cards.

## Security
Read-only render of server-provided data; no new fetch target.

## Next Steps
Feeds P05 (artifact sweep surface lives on the same tab).
