---
phase: 4
title: "Catalog browse view: standalone /catalog route"
status: pending
priority: P2
effort: "2-3d"
dependencies: [1]
---

# Phase 4: Catalog browse view — standalone /catalog route

## Context Links

- Cancelled-plan brainstorm (over-scoped predecessor): [`../reports/metadata-catalog-tab-system-meta.md`](../reports/metadata-catalog-tab-system-meta.md)
- Hybrid architecture rationale: [`../reports/architecture/cube-vs-cdp-metrics-architecture.md`](../reports/architecture/cube-vs-cdp-metrics-architecture.md) §3 (catalog is the UI mirror of the future MM-01 sync worker)
- Existing nav surface: `src/components/Header/Header.tsx`
- Existing routes: `src/index.tsx` (uses `createHashHistory`)
- Sidebar item rendering for component reuse: `src/QueryBuilderV2/components/SidePanelCubeItem.tsx`, `ListMember.tsx`
- Wizard reachable-members hook (already exists, reusable): `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts`

## Overview

New top-level route `/catalog` for browse-mode users (~50% of audience per leadership). Renders a faceted card grid grouped by `connectedComponent` cluster, with a DetailPanel for per-cube exploration. Uses only fields the live `/cubejs-api/v1/meta?extended=true` payload actually populates. No SQL snippets (not available). No env-baked secret. No PROD guard (fully shipped per leadership).

This is the demo centerpiece. Largest phase in the plan.

## Priority

P2 — biggest lift, biggest visible payoff. Depends on P1 foundation.

## Key Insights

- Schema is small (4 cubes + 7 views = 11 cards). Zero need for virtualization.
- `connectedComponent` cleanly partitions the 11 entities: 4 in cluster 1 (the hub-spoke), 7 standalone views. Map: stable visual grouping.
- All facet data lives in `/meta` (after P1):
  - `type` cube/view: 11/11
  - `aggType`: 59/59 measures
  - `description` present: 11/11 cubes, 21/59 measures, 23/215 dimensions
  - `cluster`: derived from `connectedComponent`
- Catalog UI doubles as visual contract for the MM-01 sync worker (`cube-vs-cdp-metrics-architecture.md` §3.1). Render NO field that wouldn't survive the Cube → MM-01 mapping (rules out SQL display, even if it were available).
- "Open in Playground" deep-link: route changes from `/catalog` → `/build` with the source cube pre-selected. Investigate `useQueryBuilderContext().selectCube` for pre-fill mechanics during implementation.

## Requirements

### Functional

**Navigation:**
- Third nav pill **Catalog** in `Header.tsx`, after Models. Route `/catalog`.
- Reachable from QueryBuilder, Models, and direct URL.

**Layout:**
- Left filter rail: facet checkboxes
- Top search bar: fuzzy-match name + title + description across cubes/views/measures/dimensions
- Center: card grid, grouped by cluster label ("Connected — mf_users + 3 spokes", "Standalone views")
- Right (on card click): in-page DetailPanel (slide-in panel, NOT a full-screen drawer)

**Facets (only those backed by populated /meta fields):**
- `type`: cube / view (multi-select)
- `aggType`: filters cards whose cube contains at least one measure with the selected aggType
- `has description` toggle: filters cubes/views where `description` is present
- `cluster`: connected / standalone (radio)

**Search:**
- Client-side, debounced 150ms
- Matches against: cube.name, cube.title, cube.description, measure.name, measure.title, measure.description, dimension.name, dimension.description
- Card surfaces when ANY of its members match
- Highlight matched substrings on the card

**Card content:**
- Icon (cube vs view)
- `cube.name` (mono) + `cube.title` (display)
- `cube.description` first line, truncated to ~120 chars
- Counts: measure × N, dimension × M
- aggType histogram strip: e.g. `≈ Cnt-D × 4 · Σ × 2 · Cnt × 1` (built from `cube.measures[*].aggType` group-by)
- Cluster chip (reuses P3's `ClusterBadge`)
- (P5 adds rollup count badge here)

**DetailPanel:**
- Header: cube name + title + type badge
- Description (full text, multi-line)
- Joins table (from `cube.joins[]` exposed by P1):
  - To cube · relationship · sql (mono, wrapped)
- Measures table:
  - name | aggType chip | format | description | wizard-author chip (if `meta.source === 'wizard'`)
- Dimensions table:
  - name | type | flags (PK / hidden)
- "Open in Playground" button → sets the QueryBuilder source cube and navigates to `/build`

### Non-functional
- Client-side filter + search; debounced; memoized selectors.
- Boot fetch already happens in P1's `loadMeta()` — catalog reads from the same `cubes` state via context.
- Reuse existing UI kit (`@cube-dev/ui-kit`) primitives. No new design system.

## Architecture

```
loadMeta() [P1] ─▶ cubes state (in QueryBuilderContext)
                       │
                       ▼
                CatalogPage
                   ├─ CatalogSearchBar ──▶ filterString (debounced)
                   ├─ CatalogFilterRail ─▶ activeFacets
                   ├─ use-catalog-selectors(cubes, filterString, activeFacets)
                   │    ├─ groupByCluster(cubes)
                   │    ├─ filterByFacets(grouped, activeFacets)
                   │    └─ searchAcrossMembers(filtered, filterString)
                   ├─ CatalogGrid
                   │    └─ CubeCard × N (clickable)
                   └─ CubeDetailPanel (slide-in on selectedCube)
                        └─ "Open in Playground" → setSelectedCubeInQB + navigate(/build)
```

## Related Code Files

- **Create:**
  - `src/pages/Catalog/index.ts` — barrel
  - `src/pages/Catalog/CatalogPage.tsx` — route entry + layout shell
  - `src/pages/Catalog/CatalogSearchBar.tsx` — top search input (kit `SearchInput`)
  - `src/pages/Catalog/CatalogFilterRail.tsx` — left facets
  - `src/pages/Catalog/CatalogGrid.tsx` — clustered card grid
  - `src/pages/Catalog/CubeCard.tsx` — single card
  - `src/pages/Catalog/CubeDetailPanel.tsx` — slide-in detail
  - `src/pages/Catalog/use-catalog-selectors.ts` — memoized filter + search + cluster grouping
  - `src/pages/Catalog/agg-type-histogram.ts` — derive `{ aggType: count }` per cube
- **Modify:**
  - `src/components/Header/Header.tsx` — add third NavPill `Catalog` → `/catalog`
  - `src/index.tsx` — register `/catalog` route (one Route element)
  - `src/pages/index.tsx` — export `CatalogPage`
- **Read for context:**
  - `src/QueryBuilderV2/hooks/use-reachable-members.ts` — same join-graph logic catalog wants
  - `src/QueryBuilderV2/components/InstanceTooltipProvider.tsx` (P3) — tooltip used in tables

## Implementation Steps

### 4.1 — Scaffolding (4h)

1. Create `src/pages/Catalog/` folder + all 8 files above with stub content.
2. Add `Catalog` NavPill in **both** nav surfaces of `Header.tsx`:
   - Desktop `<PillRow>` (`src/components/Header/Header.tsx:70-86`) — add a third `<NavPill to="/catalog" icon={...} active={isActive(selectedKeys, '/catalog')}>Catalog</NavPill>` after Models. Pick a `lucide-react` icon (e.g. `BookOpen` or `LibraryBig`).
   - Mobile `<Menu>` overlay (`src/components/Header/Header.tsx:90-107`) — add `<Menu.Item key="/catalog"><Link to="/catalog">Catalog</Link></Menu.Item>` after Models. Verified during validation: Header has 2 nav surfaces; both must update for desktop+mobile parity.
   Verify navigation works in both viewports.

   <!-- Updated: Validation Session 1 - mobile dropdown update added; was missing from initial spec -->

3. Register `/catalog` route in `src/index.tsx`. Verify direct URL load works.
4. `CatalogPage` reads `cubes` from `useQueryBuilderContext()`. Verify cubes array length === 11 in the page (after P1).
5. Skeleton layout: Flex with filter rail (width 240) + main column. Render placeholder text in each region.

### 4.2 — Selectors + grouping (4h)

6. Implement `use-catalog-selectors.ts`:
   - `groupByCluster(cubes)` returns `{ clusterId: 1, label: '...', cubes: [...] } | { clusterId: null, label: 'Standalone views', cubes: [...] }`.
   - Cluster label derivation: for non-null `connectedComponent`, label = `"Connected — <hubName> + N spokes"` (hub = cube with most joins; for ballistar_vn that's `mf_users` with 3).
   - `filterByFacets(grouped, activeFacets)` applies type / aggType / has-description filters.
   - `searchAcrossMembers(filtered, filterString)` returns same shape with non-matching cubes removed; member matches stored on each cube for highlight.
7. Memoize on `(cubes, filterString, activeFacets)`.

### 4.3 — Cards (6h)

8. `CubeCard.tsx`:
   - Header: icon + name (mono) + title
   - Description (single line, truncated)
   - Counts row: `M measures · N dimensions`
   - aggType histogram strip (uses `agg-type-histogram.ts`)
   - Cluster chip (reuse P3 `ClusterBadge`)
   - On click: setSelectedCube → opens DetailPanel
9. `CatalogGrid.tsx`: 3-column responsive grid, grouped by cluster with section headers.

### 4.4 — Search + filters (4h)

10. `CatalogSearchBar.tsx`: SearchInput + debounced state (use existing `useDebouncedValue` hook).
11. `CatalogFilterRail.tsx`:
    - Type checkbox group
    - aggType checkbox group (options derived from union of all cube measures' aggType)
    - "Has description" toggle
    - Cluster radio: All / Connected / Standalone

### 4.5 — DetailPanel (6h)

12. `CubeDetailPanel.tsx`:
    - Slide-in from right (use kit `Panel` or `DialogContainer` non-modal)
    - Header section: name, title, type badge, description (full)
    - Joins section (only when `cube.joins?.length > 0`): table of relationship + target + sql
    - Measures section: table sorted by aggType then name; columns: name (mono) | aggType chip | format | description (truncated) | wizard chip
    - Dimensions section: table sorted by name; columns: name | type | flags
    - Footer: "Open in Playground" button — calls `selectCube(cube.name)` + `history.push('/build')`

### 4.6 — Polish (2h)

13. Loading state (skeleton cards while meta loads on first paint).
14. Empty state when filters yield zero results.
15. Verify Playground deep-link works end-to-end.
16. Visual smoke against the 4-cube schema.

## Todo List

- [ ] Folder scaffold + stub files
- [ ] Nav pill + route registration
- [ ] `use-catalog-selectors` hook with cluster grouping
- [ ] `CubeCard` component
- [ ] `CatalogGrid` with cluster sections
- [ ] `CatalogSearchBar` debounced
- [ ] `CatalogFilterRail` with 4 facets
- [ ] `CubeDetailPanel` with joins / measures / dimensions tables
- [ ] "Open in Playground" deep-link
- [ ] Loading + empty states
- [ ] Smoke against 11-entity ballistar_vn schema

## Success Criteria

- [ ] `/catalog` route loads and displays 11 entity cards grouped into 2 clusters
- [ ] All 4 facets filter correctly (type, aggType, has-description, cluster)
- [ ] Search across name/title/description hits cube AND member fields
- [ ] Clicking a card opens DetailPanel with joins, measures, dimensions populated
- [ ] DetailPanel shows wizard-author chip on measures with `meta.source === 'wizard'`
- [ ] "Open in Playground" routes to `/build` with the cube pre-selected
- [ ] No console errors; no regression in `/build` or `/schema` pages

## Risk Assessment

- **Risk:** Hash router URL parsing for `/catalog` — verify before/during 4.1. Mitigation: trivial fix if needed.
- **Risk:** `selectCube` mechanic in deep-link — depends on QueryBuilder context being available on `/build` mount. Mitigation: probe during 4.5; fall back to URL query param (`/build?cube=mf_users`) if context-based pre-fill is fragile.
- **Risk:** "Hub" detection for cluster label is brittle (assumes single dominant cube). Mitigation: ballistar_vn has a clear hub; if schema grows, label degrades gracefully to "Connected — N cubes".
- **Risk:** Tooltip / popover in DetailPanel tables clashes with slide-in container layering. Mitigation: kit handles z-index correctly; visual smoke at end of 4.5.

## Security Considerations

- Same auth as `/build`. No new surface.
- Routes are not gated — internal-by-deployment posture per leadership ("fully shipped").
