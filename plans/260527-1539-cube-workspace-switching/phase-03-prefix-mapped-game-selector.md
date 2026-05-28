---
phase: 3
title: "Prefix-mapped game selector"
status: partial
priority: P2
effort: "1d"
dependencies: [2]
---

# Phase 3: Prefix-mapped game selector

## Overview
Make the existing game selector behave per workspace: `game_id`-scoped on `local`, and
**prefix-filtered** on `prod` (flat namespace, cubes named `cfm_*`, `cros_*`, `ballistar_*`).

## Requirements
- Functional: selecting a game on `prod` filters visible cubes/views to that game's prefix;
  on `local` it keeps current `game_id` param + token-claim behavior.
- Non-functional: no per-game prod token needed (`authMode: none`); graceful when a game has
  no cubes in the active workspace.

## Verified prefix map (live prod meta, 79 entries)
| gds.config game | prod prefix | cubes | note |
|---|---|---|---|
| `ballistar` | `ballistar` | 11 | ✓ |
| `cfm_vn` | `cfm` | 41 | ✓ |
| `cros` | `cros` | 27 | **add to `gds.config.json`** (validated) — display label TBD (CrossFire PC?) |
| `ptg`, `jus_vn`, `muaw`, `pubg` | — | 0 | not present in prod yet → shown disabled |

## Architecture
- Workspace carries `gameModel: 'game_id' | 'prefix'` and `gamePrefixMap: { [gameId]: prefix }`
  (from Phase 1 registry).
- **Filtering layer** in the consolidated meta client / catalog hook: when `gameModel==='prefix'`,
  post-filter `meta.cubes` to those whose `name` starts with `${prefix}_`; strip-prefix for
  display title only (keep real `name` for queries). When `game_id`, send `game_id` param as today.
- GamePicker (`src/components/Header/game-picker.tsx:160`) unchanged structurally; the games
  it lists stay from `gds.config.json`. A game with no prefix match in the active workspace is
  shown disabled / "no data here" (feeds Phase 5 readiness).
- Catalog hook (`use-catalog-meta.ts`) drops `game_id` query param on prefix workspaces;
  applies prefix filter instead.

## Related Code Files
- Modify: `src/api/cube-meta-client.ts` (prefix filter branch), `src/pages/Catalog/use-catalog-meta.ts`
- Modify: `src/components/Header/game-picker.tsx` (disabled state for no-data games)
- Read: `gds.config.json` (game ids), Phase 1 `workspaces.config.json` (gamePrefixMap)

## Implementation Steps
1. Surface `gameModel` + `gamePrefixMap` from WorkspaceContext.
2. Add prefix-filter branch in meta client; keep real cube `name`, derive display title.
3. On `local`, retain `game_id` param path (regression check).
4. GamePicker: disable games with no prefix data in active workspace.
5. Add `cros` to `gds.config.json` (confirm display label with DA); fill `gamePrefixMap`.
6. Verify: prod + select cfm → only `cfm_*` entries; select a game absent in prod → disabled.

## Success Criteria
- [ ] Prod + game select → cubes filtered to that prefix; query uses real names.
- [ ] Local game scoping unchanged (game_id + claim).
- [ ] Games absent in the active workspace are visibly disabled, not erroring.

## Risk Assessment
- **`game→prefix` map accuracy** — `gds.config.json` ids (`cfm_vn`) ≠ prod prefixes (`cfm`);
  `cros_` has no configured game. Map is config-driven; wrong values = empty views. Confirm with DA.
- **Prefix collisions** — ensure `${prefix}_` boundary match (not substring) to avoid bleed.
