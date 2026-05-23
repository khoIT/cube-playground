---
phase: 5
title: "Data Model tab and concept detail"
status: pending
priority: P2
effort: "5d"
dependencies: [1, 3]
---

# Phase 5: Data Model tab and concept detail

## Overview

Build the author surface — Data Model tab (concept-first grid of measures / dimensions / segments) + `ConceptDetailPage` (subsumes `MetricCardPage`). Rehome `metric-card-*` modules and `cdp-projection` as Slices-tab content. Wire `/metric/:cube/:member` redirect from P1 to land on real content.

## Requirements

**Functional:**
- Data Model tab grid renders one card per measure / dimension / segment from Cube `/meta`
- **`/meta` is already JWT-scoped to active game** (cube `repositoryFactory` from completed plan 260520) — so the grid automatically shows only the active game's concepts. **No Game filter needed** at the Data Model layer; the Header Game-Context picker is the single source of truth.
- Switching active game → re-fetch `/meta` → grid re-renders. Existing `useCatalogMeta` already handles this via the mutex pattern.
- Cards: TypeIcon (orange/blue/purple) · FQN · cube name · description · TrustBadge · FreshnessChip · DomainChip · "Used by N metrics" count (count = business metrics referencing this FQN, intersected with active-game compatibility)
- Filter rail: Type (3) · Domain · Cube (multi — within active game) · Trust · "CDP-projected only" · "Unreferenced only"
- Click card → `/catalog/concept/:type/:fqn` → ConceptDetailPage
- ConceptDetailPage shares shell with MetricDetailPage (5 tabs)
- Slices tab content for measure kind = existing `metric-card-how-to-slice` + `metric-card-joinable-with` + `metric-card-similar-measures` + `cdp-projection-card`
- `/metric/:cube/:member` redirect (P1) now lands on populated content
- Right rail: same 4 actions as MetricDetailPage; "Push to activation" enabled for segment kind only

**Non-functional:**
- "Used by N metrics" count computed in-memory from registry (no per-card fetch)
- Concept FQN URL-encoded properly (`.` allowed)

## Architecture

```
src/pages/Catalog/data-model-tab/
├── data-model-tab.tsx              # MODIFY — placeholder → full grid
├── data-model-grid.tsx             # NEW — virtualised
├── data-model-filter-rail.tsx      # NEW — 6 facets
├── concept-card.tsx                # NEW — measure/dim/segment card
├── data-model-search-row.tsx       # NEW
├── use-concepts.ts                 # NEW — derive concepts from cube /meta
├── use-filtered-concepts.ts        # NEW
└── __tests__/...

src/pages/Catalog/concept-detail/
├── concept-detail-page.tsx         # NEW — route /catalog/concept/:type/:fqn
├── concept-detail-header.tsx       # NEW
├── concept-detail-tabs.tsx         # NEW — same 5-tab strip as MetricDetail
├── tab-overview-concept.tsx        # NEW — type-specific
├── tab-formula-concept.tsx         # NEW — YAML preview + compiled SQL
├── tab-lineage-concept.tsx         # NEW — upstream cube + downstream metrics
├── tab-slices-concept.tsx          # NEW — rehomes 3 metric-card-* modules + cdp-projection
├── tab-activity-concept.tsx        # NEW — stub
└── right-rail-concept.tsx          # NEW — measure/dim/segment-aware actions

# REHOME (move, don't rewrite):
src/pages/Catalog/metric-card/      # NEW dir housing rehomed modules
├── metric-card-how-to-slice.tsx    # moved from src/pages/Catalog/
├── metric-card-joinable-with.tsx   # moved
├── metric-card-similar-measures.tsx # moved
├── measure-row.tsx                 # moved (used inside how-to-slice)
└── metric-card-styles.ts           # moved

src/pages/Catalog/cdp-projection/   # KEEP IN PLACE
├── cdp-projection-card.tsx         # rehomed import paths only
└── ...
```

**Concept derivation:** scan `useCatalogMeta()` output for measures/dimensions/segments per cube → flatten into one list with type discriminator. Each concept = `{ type, fqn, cube, name, description, meta }`.

**"Used by" count:** intersection of `business-metrics/*.yml` `formula.*` refs with concept FQN. Pure computation.

## Related Code Files

**Create:** ~18 files (see Architecture)

**Modify:**
- `src/pages/Catalog/catalog-page.tsx` — register `/catalog/concept/:type/:fqn` route
- `src/pages/Catalog/data-model-tab/data-model-tab.tsx` — replace placeholder
- `src/pages/Catalog/metric-card-page.tsx` — convert to permanent redirect
- Imports inside `cdp-projection-card.tsx` — update to new sibling paths

**Delete:** none (rehome via `git mv`)

## Implementation Steps

1. **Rehome modules.** Use `git mv` for `metric-card-how-to-slice.tsx`, `metric-card-joinable-with.tsx`, `metric-card-similar-measures.tsx`, `measure-row.tsx`, `metric-card-styles.ts` into `metric-card/` subdirectory. Fix import paths.
2. **Convert `MetricCardPage`** to a thin redirect-only component (or remove entirely if P1 routing redirect covers).
3. **Build `useConcepts()`** — derive from `useCatalogMeta`. Returns `Concept[]` with `{ type, fqn, cube, name, description, meta }`.
4. **Build `useFilteredConcepts(concepts, filters, query, businessMetrics)`** — composes Type/Domain/Cube/Trust filters + "CDP-projected" filter + "Unreferenced" filter (cross-ref with businessMetrics).
5. **Build ConceptCard.** Type-coloured icon + FQN + cube name + description + badges + "Used by N" pill.
6. **Build DataModelFilterRail.** 6 facets.
7. **Compose DataModelTab.** Mirror MetricsTab layout. "+ New building block" CTA → existing wizard `/metrics/new?v=2`.
8. **Build ConceptDetailPage shell.** Read `:type` + `:fqn` URL params. Reuse `concept-detail-tabs.tsx` strip shared with MetricDetailPage (extract to `src/shared/concept-shell/` if not yet).
9. **Build type-specific tab bodies:**
   - Overview: description + trust + freshness + owner + sample distribution (reuse `analysis/distribution-mode.tsx` for measure kind)
   - Formula: YAML preview (read-only) + compiled SQL preview (Cube `/sql` if available)
   - Lineage: upstream cube + downstream business-metrics
   - Slices: for measure → mount rehomed how-to-slice + joinable + similar + cdp-projection-card; for dim → reachable-metrics; for segment → reachable-segments / similar-segments
   - Activity: stub
10. **Wire right-rail-concept.** For segment: "Push to activation" enabled (segment IS the activation payload). For dim/measure: stubbed w/ tooltip.
11. **Test:** rehoming doesn't break existing measure-detail content; redirect from old URL lands on ConceptDetailPage; filter cross-ref works.

## Success Criteria

- [ ] Data Model tab shows all measures/dimensions/segments from /meta
- [ ] Filter by Type (measure only) narrows grid
- [ ] Filter "CDP-projected only" narrows to projectable measures
- [ ] Filter "Unreferenced only" hides concepts used by business metrics
- [ ] Click `orders.revenue_vnd` card → ConceptDetailPage opens with measure-type content
- [ ] Slices tab on measure shows how-to-slice + joinable + similar + cdp-projection-card
- [ ] Click segment card → "Push to activation" right-rail button enabled
- [ ] `/metric/orders/revenue_vnd` redirect → ConceptDetailPage with measure content
- [ ] Existing measure-detail tests still pass after rehome

## Risk Assessment

- **R2:** existing `MetricCard` component is measure-only. **Mitigation:** rehome content modules; build new shell.
- **R3:** `cdp-projection-card` is wired into measure-row expansion. **Mitigation:** rehome inside Slices tab; remove inline expansion in `detail-panel-measures.tsx`.
- **Import path churn after `git mv`.** **Mitigation:** rename in a dedicated commit; run tsc to catch breakage.
- **"Used by" computation needs both registry + /meta loaded.** **Mitigation:** show "—" or skeleton until both loaded.
- **`/metric/:cube/:member` redirect (P1) was synthetic** — verify it lands on real content now, not 404.
