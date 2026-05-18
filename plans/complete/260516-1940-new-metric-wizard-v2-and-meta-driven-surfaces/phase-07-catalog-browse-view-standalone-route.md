---
phase: 7
title: "Catalog browse view — standalone /catalog route"
status: pending
priority: P2
effort: "2-3d"
dependencies: [1]
---

# Phase 7: Catalog browse view — standalone /catalog route

## Overview

Add a new top-level "Catalog" navigation pill (third pill after Playground and Models). Click → `/catalog` route. Renders a search bar, facet panel, and grouped cube cards (clusters: connected vs standalone views). Click a cube card → in-page DetailPanel with description, joins table, all measures (with aggType + format + wizard-author chip), all dimensions, and "Open in Playground" deep-link.

Absorbed from cancelled meta-driven plan P4. Demo centerpiece.

## Requirements

- **Functional:**
  - New `/catalog` route registered in router
  - Nav pill in header (after Models)
  - Search bar searches across name / title / description (case-insensitive substring)
  - Facet panel filters: type (cube/view), aggType (cross-cube), has-description (boolean), cluster (connected/standalone)
  - Cube grid grouped by cluster: "Connected — N cubes" group + "Standalone views — M" group
  - Cube card: name, description, member counts with aggType chips (e.g. "≈Cnt-D × 4   Σ × 2")
  - Click card → in-page DetailPanel slides in from right (NOT a separate route)
  - DetailPanel: description, joins table, measure list (aggType chip + format + description + wizard-author chip), dimension list (type + PK flag + hidden flag)
  - "Open in Playground" button on DetailPanel sets `?cube=<cubeName>` and navigates to Playground
- **Non-functional:**
  - Page renders in <500ms for ballistar_vn (4 cubes + 7 views) — small payload, no virtualization needed
  - Reuses extended /meta from P1 (no new fetch)

## Architecture

```
/catalog route
├── CatalogPage
│   ├── CatalogHeader
│   ├── CatalogToolbar (search + facet panel)
│   ├── CatalogGrid
│   │   ├── ClusterGroup (connected)
│   │   │   └── CubeCard × N
│   │   └── ClusterGroup (standalone)
│   │       └── CubeCard × N
│   └── DetailPanel (slide-in from right when a card is selected)
│       ├── description
│       ├── JoinsTable
│       ├── MeasureList (with WizardAuthorChip)
│       ├── DimensionList
│       └── OpenInPlaygroundButton

State: useState<{ cubeName: string | null }>(null) for selected card
```

## Related Code Files

- **Modify:**
  - `src/App.tsx` — register `/catalog` route (react-router-dom v5 verified; uses `<Switch>` + `<Route>`)
  - `src/components/Header/Header.tsx` — add Catalog nav pill
  - `src/QueryBuilderV2/QueryBuilder.tsx` — add `?cube=` URL reader (mount-time effect)
- **Create (page-level):**
  - `src/pages/Catalog/CatalogPage.tsx` — page entry
  - `src/pages/Catalog/CatalogHeader.tsx`
  - `src/pages/Catalog/CatalogToolbar.tsx`
  - `src/pages/Catalog/CatalogGrid.tsx`
  - `src/pages/Catalog/ClusterGroup.tsx`
  - `src/pages/Catalog/CubeCard.tsx`
  - `src/pages/Catalog/DetailPanel.tsx`
  - `src/pages/Catalog/components/joins-table.tsx`
  - `src/pages/Catalog/components/measure-list.tsx`
  - `src/pages/Catalog/components/dimension-list.tsx`
  - `src/pages/Catalog/components/wizard-author-chip.tsx`
  - `src/pages/Catalog/hooks/use-catalog-filters.ts` — search + facet state
  - `src/pages/Catalog/hooks/use-cube-clusters.ts` — group cubes by `connectedComponent`
  - `src/pages/Catalog/hooks/__tests__/use-catalog-filters.test.ts`
  - `src/pages/Catalog/hooks/__tests__/use-cube-clusters.test.ts`
- **Read for context:**
  - `src/App.tsx` — router setup
  - `src/components/Header/Header.tsx` — pill rendering pattern
  - `src/QueryBuilderV2/sidebar/cluster-badge.tsx` (P6) — for shared cluster computation, factor into a shared hook if needed

## Implementation Steps

1. **Routing:** add `/catalog` to whatever router cube-playground uses. Confirm via scout (`src/App.tsx`).
2. **Nav pill:** add Catalog pill in Header next to Playground/Models. Match existing pill styling.
3. **CatalogPage skeleton:** page-level container, full-bleed. Reads meta from AppContext.
4. **useCubeClusters:** groups cubes by `connectedComponent` (P1 dependency). Returns `{ connected: Cube[][], standalone: Cube[] }`.
5. **useCatalogFilters:** state for search + facets. Returns `filteredCubes` based on:
   - search: matches name/title/description
   - type facet: cube vs view (likely via `type` field in /meta)
   - aggType: filter cubes where ≥1 measure has the selected aggType
   - has-description: filter cubes with non-empty description
6. **CubeCard:** description preview + aggType pill summary (group measures by aggType, render counts).
7. **DetailPanel:** slide-in from right (use ui-kit Drawer if available, otherwise CSS transform). Width ~480px. Closes on backdrop click + ESC.
8. **JoinsTable:** for each `cube.joins[]` (P1 dependency), render `joinedCube` + `relationship` + `sql`. If cube has no joins, show "No joins".
9. **MeasureList:** each row: name + aggType chip (P6 shared component) + format hint + description + wizard-author chip when `meta.source === 'wizard'`.
10. **DimensionList:** each row: name + type chip + PK flag (when `primaryKey === true`) + hidden flag (when `public === false`).
11. **OpenInPlaygroundButton:** `navigate('/playground?cube=<cubeName>')`. **Add `?cube=` URL reader to QueryBuilder root** (`src/QueryBuilderV2/QueryBuilder.tsx`): `useEffect` on mount parses query param, calls `setSourceCube(value)` if present, then clears the param via `history.replaceState`. ~10 lines. Verified: no current `?cube=` handler exists in QueryBuilder.
12. Tests:
   - useCubeClusters: 4 connected + 7 standalone case (ballistar_vn)
   - useCatalogFilters: search miss, type filter, aggType filter combos
   - DetailPanel snapshot: with joins, without joins

## Success Criteria

- [ ] `/catalog` route reachable; Catalog pill visible in header
- [ ] All 11 cubes/views render; clusters grouped correctly
- [ ] Search filters cards by name/title/description
- [ ] Facets filter cards
- [ ] Clicking card opens DetailPanel; ESC + backdrop close
- [ ] Wizard-authored measure shows "Wizard" chip
- [ ] "Open in Playground" deep-link sets sourceCube on landing
- [ ] All P1/P6 tests still pass

## Risk Assessment

- **Risk:** Routing infra unfamiliar — mitigation: scout step 1 confirms router shape (likely React Router or wouter); copy existing pattern.
- **Risk:** DetailPanel slide animation conflicts with main page layout — mitigation: use overlay positioning; main page unaffected.
- **Risk:** "Open in Playground" deep-link requires QueryBuilder to honor `?cube=` URL param — mitigation: add small effect in QueryBuilder root to read param on mount and call `setSourceCube`.
- **Risk:** New page bloats bundle — mitigation: lazy-load `/catalog` route via React.lazy + Suspense.

## Security Considerations

- Same auth as QueryBuilder. POC posture (no PROD guard).
