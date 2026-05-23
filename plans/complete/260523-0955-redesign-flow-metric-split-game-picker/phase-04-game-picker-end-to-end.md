# Phase 4 — End-to-end game picker (Playground × Catalog × Segments)

## Overview

- **Priority:** P0
- **Status:** pending
- GamePicker + GameContext already exist. Catalog (`use-catalog-meta`), Segments (`library-view`, `editor-view`), and NewMetric pages already consume `useActiveGameId`.
- **Gap:** Playground (`ExplorePage` / `QueryBuilderContainer`) does **not** consume `gameId`. On game switch nothing rerenders.

## Key insights

- `GameContext.setGameId` already dispatches `gds-cube:game-change` window event.
- Cube `Query` shape supports a `filters` array. We can append `{ member: 'CUBE.gameId', operator: 'equals', values: [gameId] }` if and only if the cube exposes a `gameId` dimension.
- The QueryBuilder maintains internal state. Cleanest way to re-run after switch: remount via `key={gameId}` at the `QueryTabs` level. This drops result cache but is the smallest correctness fix.

## Requirements

- On game change, Playground:
  - Updates the URL `?query=` to include the game filter.
  - Re-renders with cleared result state.
- Catalog and Segments already react correctly; we only verify and add tests.
- A cube without a `gameId` dim is left alone (no filter injected).
- Deep-linked `?query=` in Playground keeps existing filters; we merge, not replace.

## Architecture

```
src/
  components/Header/use-game-context.ts        # unchanged
  pages/Explore/ExplorePage.tsx                # subscribe to gameId; rewrite ?query= on change
  shared/game-scoping/
    apply-game-filter.ts                       # NEW: merge gameId filter into a Cube Query
    apply-game-filter.test.ts                  # NEW
  components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx
                                               # add key={gameId} on <QueryTabs> level OR
                                               # pre-process `query` via apply-game-filter
```

## Implementation steps

1. **Util** — `apply-game-filter.ts`:
   ```
   applyGameFilter(query: Query, gameId: string, cubeHasGameDim: (cubeName: string) => boolean): Query
   ```
   - For each cube referenced by query.dimensions/measures, if it has `gameId` dim and no existing filter on `cube.gameId`, append the equals filter.
   - Idempotent.
2. **ExplorePage** — subscribe to `useActiveGameId`. When it changes AND a `?query=` is present, rewrite the URL with the merged filter. Guard against loops with a ref-based diff.
3. **QueryBuilderContainer / QueryTabsRenderer** — pre-process `defaultQuery` via `applyGameFilter` before passing into `<QueryBuilder>`. Use `useActiveGameId()` + `useCubeMeta` (via `cubejsApi.meta`) to compute `cubeHasGameDim`.
4. **Re-mount key** — add `key={gameId}` on the outer `<QueryBuilder>` (or on `<QueryTabs>`). Confirms result state clears on switch.
5. **Tests** — `apply-game-filter.test.ts` covers: no game dim, existing filter, mixed cubes.
6. **typecheck**.

## Related code files

**Create**
- `src/shared/game-scoping/apply-game-filter.ts`
- `src/shared/game-scoping/apply-game-filter.test.ts`

**Modify**
- `src/pages/Explore/ExplorePage.tsx`
- `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx`

**Verify (no changes expected)**
- `src/pages/Catalog/use-catalog-meta.ts`
- `src/pages/Segments/library/library-view.tsx`
- `src/pages/Segments/editor/editor-view.tsx`

## Todo

- [ ] `apply-game-filter` util + tests
- [ ] ExplorePage game subscription
- [ ] QueryBuilderContainer wiring + remount key
- [ ] Manual smoke: switch game → result drops, filter visible in pill bar
- [ ] typecheck

## Success criteria

- Switch game while on `/build` with a measure selected → result clears, query re-runs with `gameId=<new>`.
- Switch game while on `/catalog` → metric grid refilters (already wired; verify).
- Switch game while on `/segments` → library refetches (already wired; verify).
- Deep-link with `?query=...` honors current `gameId` after page load.

## Risks

- Remounting on game change loses Playground's tab state (multiple tabs). Acceptable per UX: explicit context switch.
- A cube whose `gameId` is named differently (e.g. `appId`) will be missed. Out of scope; document as known limitation.
- Filter merging could conflict with user-set `cube.gameId` filter. Util prefers existing user filter (no-op if present).

## Security

- Game filter is **client-side only**. Cube backend must enforce game scoping via JWT/security context — out of scope for this PR. Document as a follow-up.
