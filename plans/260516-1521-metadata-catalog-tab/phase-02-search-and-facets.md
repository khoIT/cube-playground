---
phase: 2
title: "Search and Facets"
status: pending
priority: P2
effort: "1-2d"
dependencies: [1]
---

# Phase 2: Search and Facets

## Context Links

- Brainstorm: [../reports/metadata-catalog-tab-system-meta.md](../reports/metadata-catalog-tab-system-meta.md) (FilterRail design section)
- P1 outputs: `use-system-meta.ts`, `MetadataPage.tsx`, `catalog-grid.tsx`, `cube-card.tsx`

## Overview

Add the top search bar and the left FilterRail. Tier 1 facets from Cube built-ins; Tier 2 auto-detected from `meta.*` keys present in the schema. All filtering is client-side over the cached payload from P1.

## Priority

P2 — depends on P1's data pipe; gates P3's deep-link behavior because URL state (search/filter) likely belongs in the same hook.

## Requirements

### Functional
- Top search bar: fuzzy match across cube + member names, titles, descriptions, all `meta.*` values.
- Left FilterRail with Tier 1 (always-on) and Tier 2 (adaptive) facets.
- Facet selections AND search query combine (AND semantics across facets, OR within multi-select).
- Filtered card grid updates on every keystroke / selection change.
- Each facet shows live count of matching cubes.
- "Clear all filters" affordance when any filter is active.

### Non-functional
- Filter + search recompute under 50ms for up to 500 cubes (memoize aggressively).
- No URL state required in this phase (defer until P3 deep-link).

## Key Insights

- The brainstorm's adaptive Tier 2 rule (`≥3 cubes AND ≤20 unique values`) self-tunes to whatever schema conventions exist — zero hardcoded facets to maintain.
- Fuzzy match doesn't need a library; `name.toLowerCase().includes(query.toLowerCase())` across the indexed strings is enough for ~500 cubes. Skip `fuse.js` unless P4 measures show a need.
- Aggregation-type facet is **member-level** filtering — when active, it filters cubes that contain ≥1 measure of the selected type AND highlights matching members in the card.

## Architecture

```
useSystemMeta() ──> raw cubes[]
                       │
                       ▼
deriveFacets(cubes) ──> { tier1: {...}, tier2: {key, values, counts}[] }
                       │
                       ▼
useFilterState() ──> { query, tier1Selections, tier2Selections, setQuery, toggle, clear }
                       │
                       ▼
applyFilters(cubes, state) ──> filtered cubes[]
                       │
                       ▼
<CatalogGrid cubes={filtered} highlight={state.query} />

Layout shell (MetadataPage):
┌─ Search bar (top, sticky) ──────────────────────────────────┐
├─ FilterRail (left, 240px) ── CatalogGrid (right, fills) ────┤
```

## Related Code Files

**Create:**
- `src/hooks/system-meta-selectors.ts` — pure helpers: `deriveFacets()`, `applyFilters()`, `matchesQuery()`
- `src/hooks/use-filter-state.ts` — useReducer for query + facet selections + setters
- `src/pages/Metadata/search-bar.tsx` — controlled input wrapping `@cube-dev/ui-kit`'s search input
- `src/pages/Metadata/filter-rail.tsx` — left rail container
- `src/pages/Metadata/filter-group.tsx` — collapsible group (used for each facet)
- `src/pages/Metadata/facet-checkbox.tsx` — single facet value row with count

**Modify:**
- `src/pages/Metadata/MetadataPage.tsx` — add `<SearchBar />` + `<FilterRail />` + thread filter state down
- `src/pages/Metadata/cube-card.tsx` — optional: highlight matched substrings when query is active
- `src/pages/Metadata/catalog-grid.tsx` — accept filtered cubes via props (no internal fetching)

## Implementation Steps

1. **`system-meta-selectors.ts`:**
   - `deriveFacets(cubes)` → returns `{ tier1, tier2 }`:
     - **Tier 1:** fixed keys: `type` (cube/view), `dataSource`, `hasJoins`, `aggregationType` (member-level), `hasPreAggregations`, `hasDescription`, `visibility` (public/hidden).
     - **Tier 2:** scan every cube + member's `meta` object; for each key, count distinct values across schema. Keep keys where `cubeCoverage ≥ 3` AND `uniqueValues ≤ 20`. Order by coverage desc.
   - `applyFilters(cubes, state)` → returns filtered cubes; for member-level facets (aggregationType), retain cube if any measure matches.
   - `matchesQuery(cube, q)` → case-insensitive substring match across cube name/title/description/meta.values AND every member's name/title/description/meta.values.
2. **`use-filter-state.ts`:** `useReducer` with actions `SET_QUERY`, `TOGGLE_TIER1`, `TOGGLE_TIER2`, `CLEAR_ALL`. Initial: empty query, no selections.
3. **`search-bar.tsx`:** controlled input with magnifier icon, placeholder "Search cubes, measures, dimensions…", debounced 100ms (use existing `debounced-value` hook if compatible, else inline).
4. **`filter-group.tsx`:** collapsible accordion-style group; header shows label + active-count badge. Body lists `<FacetCheckbox />` per value.
5. **`facet-checkbox.tsx`:** checkbox + label + count (matching cubes for this facet value given current other filters — soft count, computed against partial filter state).
6. **`filter-rail.tsx`:** renders Tier 1 groups in fixed order, then Tier 2 groups (auto-detected, ordered by coverage). "Clear all" button at top when any filter active.
7. **Wire `MetadataPage.tsx`:** layout = `<SearchBar /><div style={display:flex}><FilterRail /><CatalogGrid /></div>`. Pass `filteredCubes` to grid. Pass query to cards for substring highlight.
8. **Optional polish in `cube-card.tsx`:** `<mark>` wrap on matched substrings in name/description.
9. **Smoke test:**
   - Type into search → grid shrinks/grows.
   - Toggle aggregation-type "countDistinct" → only cubes with such measures remain.
   - Toggle a `meta.owner` value (if schema has them) → grid filters.
   - "Clear all" resets to full grid.

## Todo List

- [ ] Write `system-meta-selectors.ts` (deriveFacets, applyFilters, matchesQuery)
- [ ] Write `use-filter-state.ts` (reducer + actions)
- [ ] Build `search-bar.tsx`
- [ ] Build `filter-group.tsx` (collapsible)
- [ ] Build `facet-checkbox.tsx` (with live count)
- [ ] Build `filter-rail.tsx` (Tier 1 + adaptive Tier 2)
- [ ] Wire layout in `MetadataPage.tsx`
- [ ] (Optional) Substring highlight in `cube-card.tsx`
- [ ] Smoke test against real schema

## Success Criteria

- [ ] Typing in the search bar filters cards in real time, matching against cube + member text.
- [ ] Tier 1 facets all render with correct counts; toggling each correctly filters the grid.
- [ ] Tier 2 facets appear automatically for `meta.*` keys present in ≥3 cubes; absent if no schema uses such conventions.
- [ ] Aggregation-type facet (member-level) filters cubes containing ≥1 matching measure.
- [ ] "Clear all filters" resets state.
- [ ] No new console errors; typecheck clean.

## Risk Assessment

- **Tier 2 false-positive facets.** Risk: a key like `meta.notes` (unique long strings) sneaks through the ≤20 unique-values threshold if the schema is small. Mitigation: also exclude any key whose median value length > 40 chars (heuristic; tune in P4).
- **Soft-count mis-computation.** Risk: facet counts that update relative to other active filters can confuse users. Mitigation: ship with static counts first (vs. unfiltered population), upgrade to soft counts only if testers ask for them.
- **Search across deep `meta` objects could be slow.** Risk: nested-object stringification per keystroke. Mitigation: precompute a flat search-index string per cube on payload load; query just matches against that string.

## Security Considerations

None new — all data was already loaded in P1. This phase is pure client-side derivation.

## Next Steps

P3 layers the detail drawer on cards with SQL snippets, sibling-measure strips, and joinable-cube chips.
