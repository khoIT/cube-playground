---
phase: 2
title: "Sidebar Settings Board (Cube/View Scoping)"
status: pending
priority: P2
effort: "3h"
dependencies: []
---

# Phase 2: Sidebar Settings Board

## Overview

Add an inline collapsible "Display" panel at the sidebar top (below search) listing all cubes/views with checkboxes. Pre-filters which cubes appear in the tree below. Cuts scroll cost for 20-30 cube schemas. Pattern: Linear "Display" menu — inline toggle list, no modal.

**Priority:** P2 · **Status:** Pending · **Risk:** Low-Medium (cross-tab race).

## Key Insights

- Industry: Linear (inline toggle list), Notion (filter views), Looker (field picker). All inline / dropdown — no modal.
- Default: all cubes visible. Missing key in config → treat as `true` (show).
- Cross-tab race is the only real risk → mitigate with `storage` event listener.

## Requirements

**Functional:**
- Collapsible panel at sidebar top, header label "Display" with gear icon.
- Checkbox per cube/view; toggle persists to localStorage immediately.
- Tree below filters to show only checked cubes.
- "Select all" / "Deselect all" links at bottom of list.
- Cross-tab sync: tab A toggles → tab B updates.

**Non-functional:**
- Default state when no localStorage entry: all visible.
- `<150 ms` toggle response (in-memory state + sync write).
- Hook file < 100 LOC.

## Architecture

**Data flow:**
```
localStorage["gds-cube:sidebar-display-config"]
        │  (init load + storage event)
        ▼
useSidebarDisplayConfig() ──► { config, visibleCubes, toggleCube, setAll }
        │
        ▼
QueryBuilderSidePanel
   ├── Display Collapse (checkboxes drive toggleCube)
   └── Cube tree (filtered by visibleCubes)
```

**Storage key:** `gds-cube:sidebar-display-config`
**Payload:** `Record<string, boolean>` — keys = cube/view names, values = visibility.

**Cross-tab sync:** subscribe to `window.addEventListener('storage', ...)` filtering on key. On event → parse new value → setState.

## Related Code Files

**Create:**
- `src/hooks/use-sidebar-display-config.ts` (~80 LOC) — state hook with storage-event listener.

**Modify:**
- `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` — render Display Collapse above existing search/tree; wrap tree mapping with `visibleCubes` filter.

**Read for context:**
- Existing UI-kit `Collapse` + `Checkbox` import sites for canonical pattern.

## Implementation Steps

1. Create `src/hooks/use-sidebar-display-config.ts`:
   - `useState` init from `localStorage.getItem(STORAGE_KEY)` (try/catch JSON.parse — corrupt → `{}`).
   - `toggleCube(name)` → next state → `localStorage.setItem` → `setState`.
   - `setAll(value: boolean, cubeNames: string[])` → bulk set.
   - `useEffect` → `window.addEventListener('storage', handler)`; handler filters event.key === STORAGE_KEY, parses, setState. Return cleanup.
   - Derive `visibleCubes` via `useMemo`: takes `allCubeNames` arg → returns names where `config[name] !== false`.
2. Open `QueryBuilderSidePanel.tsx`. Identify where cubes are currently mapped to tree nodes (likely a `cubes.map(...)` or similar).
3. Import the hook. Pass `allCubeNames` derived from cubes list.
4. Above the existing search bar, add a UI-kit `<Collapse>` titled "Display" with `Settings` lucide icon.
5. Inside Collapse: render checkbox list (one per cube), defaulting checked = `config[name] !== false`.
6. Add bottom links "Select all" / "Deselect all" → call `setAll(true/false, allCubeNames)`.
7. Wrap tree render: filter cubes by `visibleCubes.includes(cube.name)` (or equivalent — match existing data shape).
8. If sidebar already has a virtualized list, ensure filter happens on input data, not via display CSS (preserves virtualization).
9. Type-check + manual test.
10. Two-tab test: open app twice → toggle cube in tab A → verify tab B sidebar updates within 1 frame.

## Todo List

- [ ] Create `use-sidebar-display-config.ts` hook
- [ ] Add `storage` event listener for cross-tab sync
- [ ] Render Display Collapse in `QueryBuilderSidePanel.tsx`
- [ ] Wire checkboxes to `toggleCube`
- [ ] Apply `visibleCubes` filter to tree input
- [ ] Add Select all / Deselect all links
- [ ] Two-tab cross-sync test
- [ ] Type-check

## Success Criteria

- [ ] Display Collapse renders above search bar, opens/closes.
- [ ] Unchecking a cube hides its subtree below within one frame.
- [ ] Refresh page → state restored from localStorage.
- [ ] Two open tabs stay in sync via storage event.
- [ ] Missing cube name in config → treated as visible (default-on).
- [ ] Hook file < 100 LOC.
- [ ] TypeScript compiles clean.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cross-tab localStorage race | Medium | Low | `storage` event listener (no extra deps). |
| Corrupt JSON in localStorage | Low | Low | try/catch around `JSON.parse` → fall back to `{}` and overwrite. |
| Sidebar tree uses non-standard data shape (e.g., grouped/virtualized) | Medium | Medium | Read `QueryBuilderSidePanel.tsx` end-to-end before writing filter. Apply filter at data source, not display layer. |
| User has hundreds of cubes — list scrolls badly | Low | Low | Container max-height 240px with `overflow:auto`. Future: search-within-display. |

**Rollback:** Delete the hook file + revert the side-panel diff. localStorage key remains harmless (ignored if hook absent).

## Security Considerations

- localStorage is per-origin; no auth/PII stored. Cube names are not sensitive (already rendered in UI).

## Next Steps

Independent of Phases 1/3/4. Can ship anytime.
