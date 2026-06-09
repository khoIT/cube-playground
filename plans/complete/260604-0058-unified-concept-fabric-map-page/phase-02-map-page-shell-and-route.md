# Phase 2: Map Page Shell, Route & Layout

## Context Links
- Mockup screen 1: `plans/260603-0324-unified-concept-fabric/visuals/index.html` (lines 243–344) — header, legend, toolbar, 4-col board.
- Routing host: `src/index.tsx:205` (`<KeepAliveRoute path="/catalog">` → `CatalogPage`); subtab dispatch `src/pages/Catalog/catalog-page.tsx:209-224`.
- Design rules: `docs/design-guidelines.md` + CLAUDE.md page-header pattern; mirror `src/pages/Dashboards/index.tsx:17-19` (`padding:'24px 32px'`, `maxWidth`, `margin:'0 auto'`).

## Overview
- Priority: P1.
- Status: completed (2026-06-04 — subtab mounts at `/catalog/data-model/concept-map`, lazy-loaded; 15 catalog-tabs tests green, tsc clean). NOTE: the actual URL is `/catalog/data-model/concept-map` (the real peer location of Schema/Concepts/Cubes/Models subtabs), not the abstract `/catalog/concept-map` used in earlier prose.
- Create the page shell (header + legend + toolbar containers) and mount it as a route. No node rendering yet (P3) — just layout scaffolding + the `useConceptGraph` wiring from P1.

## Key Insights
- **Route placement (LOCKED): new Catalog subtab** `/catalog/concept-map`. The page is conceptually Catalog, it reuses the `CatalogPage` KeepAlive mount + `useCatalogMeta` bootstrap (`catalog-page.tsx:138`), and adding a subtab is a small change in the subtab dispatch — mirrors how Schema Cartographer is mounted (`catalog-page.tsx:213`). It needs a new entry in `catalog-tabs.tsx` (`resolveDataModelSubtab` + `DataModelSubtabs`; tests in `__tests__/catalog-tabs.test.tsx` — keep green). The top-level-route + sidebar-entry alternative is rejected — do NOT touch `index.tsx`/`sidebar.tsx`.
- Header MUST follow the fixed pattern: eyebrow `Catalog · Concept Map`, 20px/700 sans title with icon, `padding:'24px 32px'`, `maxWidth:1320`, `margin:'0 auto'` (board is wide → use the grid maxWidth, not 800). The mockup's `max-width:1320px` (line 245) already matches.
- The mockup header serif/glyph chrome is prototype-only — use lucide icons + `var(--font-sans)` only. No `Geist Mono` for headings (mono is allowed only on field sublabels per `ConceptChip` `field` kind).

## Requirements
- Functional:
  - New page component `ConceptMapPage` rendering: page-header (eyebrow + icon + title), legend row (4 layer swatches + trust badges), toolbar (search input + `LayerFilterPills`).
  - Mounted at a real route; reachable by URL; preserves `?focus=` through navigation.
  - Consumes `useConceptGraph()`; shows loading/error/empty states using existing `StatusLine` pattern.
- Non-functional: design-token-only styling; matches adjacent Catalog surfaces; no inline hex.

## Architecture
```
/catalog/concept-map ─► CatalogPage (KeepAlive host) ─► subtab dispatch ─► <ConceptMapPage>
ConceptMapPage: [PageHeader] [Legend] [Toolbar: Search + LayerFilterPills] [<board slot — filled in P3>]
```
- Reuse `LayerFilterPills` (`layer-filter-pills.tsx`) verbatim — same 4 layers, same default-all-on.
- Reuse `CartographerSearch` look or a token-styled `<input>`; do not invent a new search component.

## Related Code Files
- Create: `src/pages/Catalog/concept-map/concept-map-page.tsx` (page shell).
- Create: `src/pages/Catalog/concept-map/concept-map-legend.tsx` (legend row).
- Modify: `src/theme/tokens.css` — add 4 dedicated layer-color tokens **with dark-mode pairs**:
  `--layer-field`, `--layer-metric`, `--layer-glossary`, `--layer-segment` (Decision V1). The
  `--*-ink` names the mockup used do NOT exist; these new tokens are the canonical layer palette
  consumed by the legend (P2) and node cards (P3). Verified absent 2026-06-04. <!-- Updated: Validation Session 1 - V1 dedicated --layer-* tokens -->
- Modify: `src/pages/Catalog/catalog-page.tsx` (add `subtab === 'concept-map'` branch — ONE branch;
  mount the page **lazily** via `React.lazy(() => import('./concept-map/concept-map-page'))` wrapped
  in `<Suspense fallback={<StatusLine .../>}>` so reactflow's ~45kb is code-split out of the main
  Catalog bundle, Decision V4). <!-- Updated: Validation Session 1 - V4 lazy-load route -->
- Modify: `src/pages/Catalog/catalog-tabs.tsx` (register the subtab in `resolveDataModelSubtab` + `DataModelSubtabs`) + keep `__tests__/catalog-tabs.test.tsx` green.
- Reuse (no edit): `layer-filter-pills.tsx`, `cartographer-search.tsx`, `use-concept-graph.ts` (P1).
- Do NOT modify: `src/index.tsx`, `src/shell/sidebar/sidebar.tsx`, `use-visible-nav-items` — top-level-route alternative rejected (Catalog subtab is locked).

## Implementation Steps
1. Scaffold `ConceptMapPage` with header + legend + toolbar; wire `useConceptGraph`, render status lines; leave a `<div>` board slot for P3.
2. Build `concept-map-legend.tsx` from mockup lines 260–271 using the new layer tokens added above (`--layer-field`, `--layer-metric`, `--layer-glossary`, `--layer-segment` — Decision V1). The same 4 tokens are reused by P3 node cards so swatches and nodes stay in lockstep.
3. Register the subtab: add `'concept-map'` to `resolveDataModelSubtab` + a `DataModelSubtabs` tab label; add the dispatch branch in `catalog-page.tsx`.
4. Manual smoke: navigate to `/catalog/concept-map`, confirm header/legend/toolbar render and match an adjacent page visually.

## Todo List
- [x] Add `--layer-{field,metric,glossary,segment}` tokens (+ dark-mode pairs) to `tokens.css` (V1)
- [x] `concept-map-page.tsx` shell (header + toolbar + status states) — default export for lazy
- [x] `concept-map-legend.tsx` using the new layer tokens
- [x] Register subtab in `catalog-tabs.tsx` (+ updated catalog-tabs tests)
- [x] Add `React.lazy` + `Suspense` dispatch branch in `catalog-page.tsx` (V4 code-split)
- [x] `tsc` clean (visual cross-check pending live run)

## Success Criteria
- [ ] `/catalog/concept-map` renders the shell; reachable via URL and via the new subtab.
- [ ] Header matches the fixed pattern (eyebrow, 20px/700 title, 24px/32px padding, centered, maxWidth).
- [ ] Legend + toolbar use only design tokens; visually consistent with adjacent Catalog tabs.
- [ ] Loading/error/empty states render.

## Risk Assessment
- **Route choice churn** (Low — resolved): Catalog subtab is locked. Page still renders its own header so it stays self-contained.
- **Lazy boundary regressions** (Low): `React.lazy` needs a default export on `concept-map-page.tsx` and a `<Suspense>` fallback at the dispatch site; a missing fallback flashes blank. Mitigation: reuse the existing `StatusLine` loading component as the fallback.
- **New token drift** (Low): the 4 `--layer-*` tokens must define dark-mode pairs like the rest of `tokens.css`; a missing pair = wrong color in dark mode. Mitigation: add them in the same block as the existing `--qb-*` pairs and visually diff both themes.

## Security Considerations
- Route is read-only browse; no new authz surface. Inherits Catalog's auth gate.

## Next Steps
- Unblocks P3 (fills the board slot) and P4 (focus/filter wiring).
