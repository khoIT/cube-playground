# Phase 4: Focus, Deep-Link, Filters & Navigation

## Context Links
- Existing `?focus=` parser to REUSE (do not fork): `cartographer-page.tsx:82` (`parseFocusRef`), `:95` (`isBareDataModelRef`), `:103` (`extractDataModelFqn`), `:109` (`useFocusFromQuery`).
- Filter pills: `layer-filter-pills.tsx` (`LayerFilter`, `ALL_LAYERS`).
- Hash router: `src/index.tsx:109` (`createHashHistory`); deep-links are `#/catalog/concept-map?focus=<ref>`.

## Overview
- Priority: P1.
- Status: completed (2026-06-04 — URL-backed focus, search, layer gating, cross-nav; tsc clean, tests green).
  SCOPE NOTE: cross-layer navigation is delivered two ways — (a) in-map re-focus on node click for ANY layer (the core interaction), and (b) an external "open detail" link in each node footer reusing the relations-panel `to=` targets (metric/term/segment). The full ConceptHoverCard-on-canvas integration was NOT added (kept nodes lean; the footer link covers the deep-link-out requirement at far lower risk).
- Wire interactivity: click-to-focus, `?focus=<namespaced-ref>` deep-link round-trip across all 4 layers, search filtering, layer-filter gating, and cross-layer click navigation via ConceptChip targets.

## Key Insights
- The Cartographer already generalised `?focus` from `cube.member` to namespaced refs
  (`parseFocusRef`, `cartographer-page.tsx:82`). **Decision V3 (locked): direct import** of the
  exported `parseFocusRef`/`extractDataModelFqn`/`useFocusFromQuery` (`cartographer-page.tsx:82,103,109`,
  verified exported 2026-06-04). No extraction to a shared module, no Cartographer refactor — the
  map page imports them as-is. One parser, zero fork, 23 Cartographer tests untouched.
- The map page's advantage over the shipped relations-panel: a non-`data_model` focus ref
  (e.g. `business_metrics/dau`) DOES highlight a node here — the documented Cartographer
  limitation ("tree has no metric rows", `phase-05-unified-map.md` Implementation Outcome)
  is resolved because every layer has node cards. This is the headline win of this page.
- Focus drives: (a) highlighted node card (`.focus`), (b) `useFocusEdges(ref)` → drawn
  edges (P3), (c) dimming of unconnected nodes. Clicking an edge target / hover-card action
  re-focuses (same-page) OR deep-links to the target's existing detail route (metric/term/
  segment) — reuse the exact `to=` targets the relations panel already uses
  (`concept-relations-section.tsx:93,115,136`).

## Requirements
- Functional:
  - Click a node → set `?focus=<ref>` (replace history), highlight + draw edges.
  - `?focus=<ref>` on load → focus that node in any of the 4 layers (round-trips for all namespaces, not just data_model).
  - Search input filters node cards across all layers (case-insensitive label/sublabel match), mirroring `searchMembers` semantics.
  - `LayerFilterPills` hide/show whole columns (Fields/Metrics/Glossary/Segments); ≥1 layer always on.
  - Cross-navigation: hover-card "Open metric/segment/term" actions deep-link to existing detail pages (reuse relations-panel `to=` targets); in-map relation chips re-focus.
- Non-functional: URL is the single source of focus truth (back/forward work); no local focus state divergence.

## Architecture
```
URL ?focus=<ref> ──(useFocusFromQuery)──► focusedRef
node click ──► setFocus(ref) ──► URL update ──► re-render (highlight + edges + dim)
search query ──► visibleRefs filter ──► columns render subset
layer pills ──► activeLayers ──► column visibility
```
- Direct-import `useFocusFromQuery`/`parseFocusRef` from `cartographer-page.tsx` (V3); do not replicate. Focus value stays the namespaced ref so back-compat bare `data_model` refs still resolve.

## Related Code Files
- Create: `src/pages/Catalog/concept-map/use-map-focus.ts` (focus-from-query for the map; thin reuse of shared helpers).
- Modify: `concept-map-page.tsx` (P2) — own focus/search/filter state, pass to `<ConceptBoard>`.
- Modify: `concept-board.tsx` / `concept-node-card.tsx` (P3) — accept `focusedRef`, `onFocus`, `dimmed`.
- Do NOT modify `cartographer-page.tsx` — Decision V3 locks direct import of its exported focus helpers; no extraction, no behavior-preserving refactor. Its 23 tests stay untouched.
- Reuse (no edit): `cartographer-page.tsx` (import `parseFocusRef`/`extractDataModelFqn`/`useFocusFromQuery`), `layer-filter-pills.tsx`, `use-focus-edges.ts`, ConceptChip `to=` targets.

## Implementation Steps
1. Add focus state via `?focus` (reuse/extract `parseFocusRef` + `useFocusFromQuery`); resolve `focusedRef` → node via P1 `byRef`.
2. Wire node click → `setFocus`; pass `focusedRef`/`dimmed` into board (P3).
3. Implement search filter over all node labels/sublabels; intersect with layer filters.
4. Layer pills gate columns (not just panel sections as in Cartographer — here they hide columns).
5. Hover-card / relation-chip navigation: re-focus within map for in-layer targets; deep-link to detail routes for cross-page targets (reuse existing `to=`).
6. Verify round-trip: load `/catalog/concept-map?focus=business_metrics/<id>` focuses the metric node + draws its edges.

## Todo List
- [x] `use-map-focus.ts` (direct-import `parseFocusRef`)
- [x] Click-to-focus + URL round-trip (all 4 namespaces)
- [x] Search filter across layers (+ clears focus when focused node hidden)
- [x] Layer pills gate columns
- [x] Cross-layer navigation (in-map re-focus + external detail link)
- [x] Direct-import focus helpers from `cartographer-page.tsx` (V3 — no extraction)
- [x] `tsc` clean

## Success Criteria
- [ ] One URL explores all 4 layers; `?focus=<ref>` highlights the right node for ANY namespace (incl. `business_metrics/`, `glossary/`, `segments/` — the Cartographer gap closed).
- [ ] Click → focus → edges draw → unconnected nodes dim; back/forward restores focus.
- [ ] Search + layer filters narrow the board; ≥1 layer always visible.
- [ ] Cross-layer chips navigate (re-focus in-map or deep-link to detail), reusing existing targets.

## Risk Assessment
- **Focus-helper fork** (High → avoided): do NOT copy-paste `parseFocusRef`. Direct-import the exported helpers (V3); a fork drifts from the bare/namespaced disambiguation that Cartographer tests guard (`cube members never contain '/'`, per `phase-05` notes).
- **History thrash** (Med): use `history.replace` (mockup of Cartographer's `useFocusFromQuery`) not `push`, so focus changes don't spam back-stack.
- **Filter hides focused node** (Med): mirror Cartographer's guard (`cartographer-page.tsx:155-158`) — clear focus when search/filter excludes it, so no orphan edges.

## Security Considerations
- Deep-link targets reuse existing detail routes (already authz-scoped). No new write/permission surface.

## Next Steps
- Unblocks P5 (end-to-end + a11y + docs over the finished interactions).
