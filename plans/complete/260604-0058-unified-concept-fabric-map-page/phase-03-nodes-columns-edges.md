# Phase 3: Node Cards, Columns & Edges (reactflow)

## Context Links
- Mockup board: `plans/260603-0324-unified-concept-fabric/visuals/index.html` lines 135–342 (`.board`, `.cols`, `.node`, `<path>` edges) + screenshot `screen-1-map.png`. Mockup is SVG, but we render with `reactflow` (resolved decision 2026-06-04) — keep the *layout/anatomy* from the mockup, not its SVG mechanics.
- Reuse: `ConceptChip` (`src/components/concept-chip/concept-chip.tsx`) icon/color vocabulary, `ConceptHoverCard` (`src/components/concept-hover-card/concept-hover-card.tsx`).
- Design rules: `docs/design-guidelines.md` + CLAUDE.md design-system section — custom node components MUST use design tokens.

## Overview
- Priority: P1.
- Status: completed (2026-06-04 — reactflow ^11.11.4 in; 18 concept-map tests green, tsc clean).
  DEVIATIONS (DRY/KISS): (1) the 4 per-layer node files collapsed into a single `BaseNode`
  registered for all 4 nodeTypes keys (it discriminates on `data.node.kind` via `LAYER_VISUAL`)
  — 4 identical wrappers would be pure duplication; (2) `ColumnHeaderStrip` inlined into
  `concept-board.tsx` (small, board-specific) rather than a separate file; (3) focus is local
  page state this phase — P4 lifts it to the URL.
- Render the 4-layer board with **`reactflow`**: one custom node type per layer, nodes laid out in 4 deterministic columns, and reactflow edges drawn from the focused node to its resolved-relation targets (focus-scoped, P1 lazy-edge decision).

## Key Insights
- **reactflow** (resolved Q1) provides the `<ReactFlow>` canvas, pan/zoom/drag, viewport controls, and edge rendering. We do NOT pull an auto-layout engine (no dagre) — column x/y are **hand-computed deterministic** (YAGNI; the layout is a fixed 4-column grid, not a graph that needs untangling).
- Layout mapping: each `ConceptNode` → a reactflow `Node` with `{ id: ref, type: layer, data, position:{x,y} }`. `x` = column index × column-width; `y` = stacked index × row-pitch within its layer column. Compute positions in a pure helper so it's unit-testable without mounting reactflow.
- Edges: only the focused node contributes edges (P1 `useFocusEdges`) → at most ~4–8 reactflow `Edge[]`. Non-connected nodes get a dimmed style when a focus is active. reactflow handles the actual curve rendering — no manual `getBoundingClientRect`/SVG-path math (this removes the Phase-3 "absolute SVG over flow layout" timing trap entirely).
- Node card anatomy from mockup lines 140–152: glyph + label, mono sublabel, footer with trust badge + visibility. Reuse `ConceptChip`'s icon/color vocabulary inside the custom node so a "metric" node reads identically to a metric chip elsewhere. Fields render mono sublabel (`mf_users.x`).
- Trust badges: metrics/terms carry real `trust` from `useConceptGraph`; app-segments are `certified`-by-construction (same constant the relations panel uses, `concept-relations-section.tsx:141`); fields are read-only (no badge, "read-only" tag).
- **Tokens on a DOM canvas:** reactflow renders DOM nodes (not canvas), so custom node components style with `var(--font-sans)`, semantic color tokens, and the spacing scale exactly like other pages. Per-layer node accent colors use the 4 dedicated tokens added in P2 — `--layer-field`, `--layer-metric`, `--layer-glossary`, `--layer-segment` (Decision V1) — so each node matches its legend swatch. Override reactflow's default node/edge CSS (it ships `dist/style.css`) with token-based styles; do NOT leak reactflow's default blue/grey palette.
- **Per-layer node cap (Decision V2):** `build-layout` caps each layer at ~50 nodes on first render and emits a synthetic "show N more" affordance per capped column; expanding a column lifts its cap. reactflow virtualizes the viewport but NOT node count, so an uncapped Fields column on a large `/meta` would mount hundreds of DOM nodes. The cap is a `build-layout` parameter (unit-tested), not ad-hoc UI state.

## Requirements
- Functional:
  - 4 layer columns with headers (`Data Model · Fields`, `Metrics`, `Glossary`, `Segments`), colored swatch + count. (Column headers can be reactflow non-interactive label nodes or a fixed overlay — pick the simpler; recommend a fixed header strip above the canvas.)
  - Custom node per layer: glyph/icon, label, sublabel, trust/visibility footer; hover→`ConceptHoverCard`; click→focus (P4).
  - reactflow edges focused-node → each `useFocusEdges` target; non-connected nodes dimmed when a focus is active.
  - Per-layer cap ~50 nodes on first render with a "show N more" expander when a column exceeds the cap (Decision V2); count in the header reflects the true total, not the capped view.
  - Empty column state when a layer has no nodes (or is filtered off).
- Non-functional: edges/positions recompute on data or focus change only; reactflow viewport handles pan/zoom (no per-frame custom physics). `fitView` on first load.

## Architecture
```
<ConceptBoard>                          ← owns reactflow state
  <ColumnHeaderStrip/>                  ← fixed 4-col header (swatch+label+count)
  <ReactFlow
     nodes={layoutNodes}                ← buildLayout(graph, filters) → Node[]
     edges={focusEdges}                 ← useFocusEdges(focusedRef) → Edge[]
     nodeTypes={{ field, metric, term, appSegment }}
     onNodeClick={setFocus}             ← P4
     fitView panOnScroll zoomOnPinch >
     <Background/> <Controls/>
  </ReactFlow>
```
- `buildLayout(graph, filters)`: pure fn, `ConceptNode[] → reactflow Node[]` with deterministic `position` per layer column. Unit-tested without mounting.
- Custom node components (`FieldNode`, `MetricNode`, `TermNode`, `SegmentNode`) share a `BaseNode` for card chrome (tokens + ConceptChip icon vocab + HoverCard); differ by icon/color/footer.
- Dim logic: when `focusedRef` set, nodes not in `{focusedRef} ∪ edgeTargets` get a `dimmed` class via node `data`/`className`.

## Related Code Files
- Create: `src/pages/Catalog/concept-map/concept-board.tsx` (`<ReactFlow>` host + nodeTypes + header strip).
- Create: `src/pages/Catalog/concept-map/build-layout.ts` (pure `ConceptNode[] → Node[]` deterministic column layout).
- Create: `src/pages/Catalog/concept-map/nodes/base-node.tsx` (card chrome: tokens + ConceptChip icons + HoverCard + forwardRef-free, reactflow handles refs).
- Create: `src/pages/Catalog/concept-map/nodes/{field,metric,term,segment}-node.tsx` (per-layer custom node types).
- Create: `src/pages/Catalog/concept-map/concept-map.css` (token-based overrides of reactflow defaults).
- Create: `__tests__/build-layout.test.ts` (deterministic positions), `__tests__/base-node.test.tsx` (icon/trust per kind).
- Modify: `concept-map-page.tsx` (P2) — fill the board slot with `<ConceptBoard>`; wrap in `<ReactFlowProvider>` if hooks need it.
- Modify: `package.json` — add `reactflow` dependency.
- Reuse (no edit): `concept-chip.tsx`, `concept-hover-card.tsx`, `use-focus-edges.ts` (P1).

## Implementation Steps
1. **Install dependency:** `npm i reactflow` (pin a known-good version, e.g. `^11.x`; supports React 18.3.1 — verified; note ~45kb bundle add). Import `reactflow/dist/style.css` once at the page/board level. reactflow is imported only inside `concept-board.tsx`, which sits behind P2's lazy `ConceptMapPage` boundary (V4) — so the ~45kb stays code-split out of the main Catalog bundle automatically.
2. `concept-map.css`: override reactflow node/edge/handle defaults to design tokens (no default blue/grey leak).
3. `base-node.tsx`: card chrome per mockup anatomy using tokens + ConceptChip icon/colors + HoverCard on hover.
4. `{field,metric,term,segment}-node.tsx`: per-layer node types wrapping BaseNode with the right icon/color/footer (field=read-only tag, metric/term=trust badge, segment=certified).
5. `build-layout.ts`: pure fn → deterministic column x/y per layer; honor filter (filtered-off layers excluded) AND the per-layer cap (~50; V2) returning both the laid-out nodes and a per-layer `hiddenCount` for the "show more" affordance; expanding a column raises its cap. Unit test caps + positions.
6. `concept-board.tsx`: `<ReactFlow nodeTypes=... nodes=buildLayout(...) edges=useFocusEdges(...)>` + header strip + `<Background>`/`<Controls>`; `fitView` on mount; dim non-connected nodes when focus active; empty-column placeholder.
7. Tests: layout geometry (pure fn, deterministic input → known positions), node renders correct icon/trust per kind.

## Todo List
- [x] `npm i reactflow` (^11.11.4) + import its stylesheet
- [x] `concept-map.css` token overrides (no default palette leak)
- [x] `base-node.tsx` (icon vocab + accent + trust footer + handles + a11y attrs)
- [x] Custom node types — single `BaseNode` registered for all 4 keys (DRY; see Overview deviation)
- [x] `build-layout.ts` pure deterministic layout + per-layer cap/`hiddenCount` (V2) + test
- [x] `concept-board.tsx` (ReactFlow host + inlined header strip + dim + "show more" expander)
- [x] Tests for layout geometry, per-layer cap, focus/dim, + node card (18 tests)
- [x] `tsc` clean (visual parity + prod build pending live run)

## Success Criteria
- [ ] 4 layer columns render all nodes from `useConceptGraph`, colored + counted per layer.
- [ ] Hovering a node opens `ConceptHoverCard`; node icons/trust match chips elsewhere.
- [ ] With a focus set, reactflow edges connect focused node → its relation targets; others dim.
- [ ] `build-layout` pure fn unit-tested; layout deterministic; pan/zoom/`fitView` work.
- [ ] reactflow default palette fully overridden by design tokens (no stray blue/grey).

## Risk Assessment
- **reactflow palette/CSS leak** (Med): reactflow ships opinionated default styles. Mitigation: import its stylesheet once, then override node/edge/handle/controls via `concept-map.css` with tokens; visually diff against an adjacent page before shipping.
- **Bundle cost** (Low): ~45kb added (user-accepted). Code-split the map page route so it doesn't bloat the main Catalog bundle if measurable.
- **Manual column layout drift** (Low): positions are hand-computed; keep them in the tested pure `build-layout.ts` so a layout change is a unit-test change, not eyeballing.
- **Node count perf** (Med → mitigated): a column with 100s of fields. reactflow virtualizes the viewport but not node count. Mitigation is in-scope (Decision V2): `build-layout` caps each layer at ~50 + "show N more" expander on first render — not deferred.
- **a11y on canvas** (Med): reactflow pan/zoom is mouse-first. Keyboard focus + node activation handled in P5; note here so node components expose accessible roles/labels.

## Security Considerations
- Pure presentation over P1 data; no new fetch/authz.

## Next Steps
- Unblocks P4 (focus state, deep-link, filter integration drive `onNodeClick` + `useFocusEdges`).
