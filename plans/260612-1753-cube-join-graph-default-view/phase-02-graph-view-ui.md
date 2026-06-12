---
phase: 2
title: Graph view UI
status: completed
priority: P2
effort: 6h
dependencies:
  - 1
---

# Phase 2: Graph view UI

## Overview

ReactFlow canvas rendering the Phase-1 graph inside the Catalog, with the model-viewer's
interaction grammar (select cube → highlight its edges with key labels, search dims rest,
view-highlight, hover description) wired to playground chrome: global game/workspace selector,
existing `DetailPanel` on click, design tokens, dark mode. Code-split like Concept Map.

**MANDATORY before any UI code: read `docs/design-guidelines.md`** (project CLAUDE.md rule)
and mirror Catalog/Concept Map patterns rather than re-deriving styles.

## Requirements

- Functional:
  - `CubeGraphPage` (default export for `React.lazy`): toolbar + board + DetailPanel host.
  - Data via existing `useCatalogMeta()` — no new fetch. Memoized `buildJoinGraph(cubes, prefix)`.
  - Board: reactflow@11 (already a dep, used by `concept-map/`). Custom `cubeNode` type;
    cluster boxes as non-interactive background nodes (zIndex below, `selectable:false`)
    sized from Phase-1 `clusterRects`; nodes draggable (no persistence — YAGNI, positions
    reset on reload); pan/zoom/fitView + `Controls`.
  - Edges: dimmed by default, labels hidden. Selecting a node highlights connected edges
    (color + animated false, label = `keyLabel · cardinality`), dims the rest — same pattern
    as `concept-map/use-focus-edges.ts`, reuse/adapt it.
  - Click node → existing `DetailPanel` (`src/pages/Catalog/detail-panel.tsx`,
    props `{cube: CatalogCube, onClose}`) — gives measures/dims/pre-agg badges/Open in Explore
    for free. Click empty canvas → deselect + close panel.
  - Toolbar: search input (substring match on name/title; matches highlighted, rest dimmed),
    view-highlight `<select>` (views from meta `type==='view'`, composition from Phase-1
    `view-composition`), lint summary chip ("2 isolated · 1 missing target" — click cycles
    focus through flagged nodes; hidden at zero).
  - Lint badges on flagged nodes (isolated / missing-target) using `--warning-soft/-ink` tokens.
  - Empty/loading/error states mirror `CatalogBrowseBody` (`StatusLine` pattern).
  - Game/workspace switch (existing global selectors) re-renders graph automatically via
    `useCatalogMeta` re-fetch — no extra wiring beyond memo deps.
- Non-functional: graph bundle code-split (lazy import; reactflow already split via concept-map —
  verify shared chunk, don't double-load). Files ≤200 LOC → split board/node/toolbar.
  Largest local model = cfm (28 nodes, 25 edges) — no perf risk; no virtualization.

## Architecture

```
CubeGraphPage (lazy)
 ├─ useCatalogMeta() ──► buildJoinGraph + clusterGridLayout + viewComposition (memo)
 ├─ CubeGraphToolbar (search / view-select / lint chip)
 ├─ CubeGraphBoard (ReactFlow: clusterBoxNode + cubeNode, focus-edge highlighting)
 │    └─ selection state ──► highlight sets (edges, search hits, view members)
 └─ DetailPanel (existing, right side) ← selected CatalogCube
```

## Related Code Files

- Create: `src/pages/Catalog/cube-graph/cube-graph-page.tsx`
- Create: `src/pages/Catalog/cube-graph/cube-graph-board.tsx`
- Create: `src/pages/Catalog/cube-graph/cube-graph-toolbar.tsx`
- Create: `src/pages/Catalog/cube-graph/cube-node.tsx` (+ cluster box node in same file if it fits ≤200 LOC)
- Create: `src/pages/Catalog/cube-graph/__tests__/cube-graph-page.test.tsx`
- Read for context/reuse: `src/pages/Catalog/concept-map/concept-board.tsx`,
  `concept-map/use-focus-edges.ts`, `concept-map/concept-map.css`, `concept-map/build-layout.ts`,
  `src/pages/Catalog/detail-panel.tsx`, `src/pages/Catalog/catalog-toolbar.tsx`,
  `docs/design-guidelines.md`, `model-viewer/index.html` (interaction reference only)

## Implementation Steps

1. Read `docs/design-guidelines.md` + concept-map board/node code; list reusable pieces
   (focus-edge hook, css import pattern, lazy/code-split shape).
2. Build `cube-node.tsx`: name (mono 12px), cluster color accent (semantic token per cluster —
   define a small cluster→token map, NO raw hex), lint badge slot, selected ring via `--brand`.
3. Build board: convert Phase-1 output to reactflow nodes/edges; cluster boxes first (background),
   then cube nodes with `parentNode` unset (absolute positions from layout); wire selection,
   `fitView` on game change.
4. Edge highlight: adapt `use-focus-edges` to cube graph (selected node id → connected edge ids).
5. Toolbar + states; wire search/view-highlight/lint chip into dim/highlight sets.
6. Page assembly + `DetailPanel` integration; deselect on close.
7. Tests (vitest + @testing-library/react, **no jest-dom matchers** — use `toBeTruthy()` /
   `toBeNull()` per codebase convention; mock reactflow minimal or render with
   `ResizeObserver` polyfill as concept-map tests do — copy their setup):
   nodes render from fixture, click opens DetailPanel, search dims non-matches,
   lint chip count, view-highlight set.
8. Visual cross-check (project CLAUDE.md rule 6): playwright screenshot vs Concept Map +
   Cubes tab — typography/padding/token drift = bug. Light + dark mode.

## Success Criteria

- [ ] Graph renders cfm: 24 cube nodes in cluster boxes, edges dimmed, select highlights with key labels
- [ ] Node click opens existing DetailPanel; Open in Explore works from it
- [ ] Search, view-highlight, lint chip behave per spec; lint shows jus/muaw known gaps
- [ ] Dark mode correct (tokens only, zero raw hex in new files)
- [ ] Suites pass; typecheck clean; reactflow not double-bundled (one shared chunk)

## Risk Assessment

- **reactflow test environment** (ResizeObserver/DOM measurement): copy concept-map's test
  setup verbatim; if board untestable cheaply, test page-level logic with board mocked.
- **DetailPanel coupling**: it expects `CatalogCube` — graph nodes carry the cube name; look up
  from the same `cubes` array, so no shape drift possible.
- **Cluster color sprawl**: 9 clusters vs limited semantic tokens — map several clusters to one
  hue family with the legend disambiguating; do NOT invent new tokens (design-guidelines rule 1).
