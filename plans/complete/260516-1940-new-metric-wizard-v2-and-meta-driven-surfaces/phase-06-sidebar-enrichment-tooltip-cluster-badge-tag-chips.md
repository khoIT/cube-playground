---
phase: 6
title: "Sidebar enrichment — tooltip + cluster badge + tag chips"
status: pending
priority: P2
effort: "1d"
dependencies: [1, 2]
---

# Phase 6: Sidebar enrichment — tooltip + cluster badge + tag chips

## Overview

Enrich the existing QueryBuilder sidebar with three additions:
1. **Tooltip:** hovering any measure reveals `description` + `aggType` chip + `format` hint (data is already in extended `/meta` post-P1; drop point is `ListMember.tsx`).
2. **Cluster badge:** each cube card header shows "Joins to N cubes" or "Standalone" derived from `cube.connectedComponent`.
3. **TagFilterChips:** new chip bar above measure list. Reads tag union from `/meta`. Multi-select union mode; persisted via URL query param `?tags=a,b`.

Parallelizable with P3-P5 (different files).

## Requirements

- **Functional:**
  - Tooltip shows description (when present), aggType chip with icon, format hint (e.g. "Currency · VND" derived from `formatDescription`)
  - Cluster badge: count of cubes in the same `connectedComponent`; "Standalone" if cube is in its own component
  - TagFilterChips: lists all tags from `meta.cubes[].measures[].meta.tags` union, alphabetically; click toggles selection; multi-select union (measure shown if ANY selected tag matches)
  - URL persistence: `?tags=revenue,daily`. Bookmarkable + shareable.
  - Clear button visible when ≥1 tag selected
- **Non-functional:**
  - No virtualization (ballistar_vn scale: ~10 tags max)
  - Sidebar still renders < 100ms on cold load (no extra fetch — reuses context meta)

## Architecture

```
QueryBuilderSidebar
├── TagFilterChips   ← new (above CubeList)
└── CubeList
    └── CubeCard
        ├── CubeHeader (name + ClusterBadge ← new)
        └── MemberList
            └── ListMember (hover → MeasureTooltip ← new)
```

```ts
function useFilteredMeasures(selectedTags: string[]): Measure[] {
  if (selectedTags.length === 0) return allMeasures;
  return allMeasures.filter(m => m.meta?.tags?.some(t => selectedTags.includes(t)));
}
```

URL state: `useSearchParams` from existing router. `?tags=a,b` parsed into `Set<string>`. Updates push (not replace) so back-button works.

## Related Code Files

<!-- Updated: Validation Session 1 — sidebar files placed in components/ to match codebase convention; no sidebar/ subdir created -->

- **Modify:**
  - `src/QueryBuilderV2/components/ListMember.tsx` — wire MeasureTooltip
  - `src/QueryBuilderV2/components/SidePanelCubeItem.tsx` — add ClusterBadge to cube header
  - `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` — mount TagFilterChips above measure list
- **Create:**
  - `src/QueryBuilderV2/components/measure-tooltip.tsx`
  - `src/QueryBuilderV2/components/cluster-badge.tsx`
  - `src/QueryBuilderV2/components/tag-filter-chips.tsx`
  - `src/QueryBuilderV2/components/agg-type-chip.tsx` — small icon + label (Σ, Cnt, ≈Cnt-D, ƒx)
  - `src/QueryBuilderV2/hooks/use-selected-tags.ts` — URL ↔ Set<string>
  - `src/QueryBuilderV2/hooks/__tests__/use-selected-tags.test.ts`
- **Read for context:**
  - `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` — sidebar entrypoint
  - `src/QueryBuilderV2/components/ListMember.tsx` — measure row + existing tooltip provider (`InstanceTooltipProvider.tsx`)
  - `src/QueryBuilderV2/components/SidePanelCubeItem.tsx` — cube header rendering

## Implementation Steps

1. Sidebar structure already verified: `ListMember.tsx` is the measure-row component; `SidePanelCubeItem.tsx` is the cube header; `QueryBuilderSidePanel.tsx` is the entrypoint. Existing tooltip plumbing in `InstanceTooltipProvider.tsx` — reuse rather than create new tooltip infra.
2. **AggTypeChip:** map `aggType` → `{ label, symbol }`:
   - `sum` → `Σ`
   - `count` → `Cnt`
   - `countDistinct` / `countDistinctApprox` → `≈ Cnt-D`
   - `avg` → `μ`
   - `min` / `max` → `↓` / `↑`
   - `ratio` (computed) → `÷`
3. **MeasureTooltip:** uses ui-kit `Tooltip`. Content: title (bold), description (if present), aggType chip, format hint.
4. **ClusterBadge:** computes cluster size = count of cubes with same `connectedComponent` value. Render as small chip in header.
5. **useSelectedTags:** reads `tags` URL param, returns `{ selectedTags, toggle, clear }`. Pushes URL updates.
6. **TagFilterChips:** renders all tags as toggle chips. Active chip orange-filled.
7. Filter measure rows by selected tags (union match). Empty selection = show all.
8. Tests:
   - `useSelectedTags`: parse, toggle, clear, URL sync
   - `useFilteredMeasures`: empty/single/multi tag scenarios
   - Snapshot for TagFilterChips with 0 / 3 / 10 tags
9. Visual smoke: open QueryBuilder, hover a measure (tooltip), verify cluster badge, toggle a tag chip.

## Success Criteria

- [ ] Hover any measure → tooltip with description + aggType + format
- [ ] Cube card shows cluster badge (e.g. "Joins to 3 cubes" or "Standalone")
- [ ] Tag chip bar appears above measure list; clicking filters
- [ ] URL updates to `?tags=...`; refreshing the page restores selection
- [ ] Clear button removes all selected
- [ ] Measure with no tags is shown when no tags selected; hidden when ≥1 tag selected and measure has no match

## Risk Assessment

- **Risk:** Sidebar component paths may differ — mitigation: scout step 1 confirms file structure before any edits.
- **Risk:** Tooltip flicker on rapid hover — mitigation: ui-kit Tooltip handles debounce.
- **Risk:** URL state collides with existing query-builder URL state — mitigation: namespace under `tags=` only; existing state uses different keys.

## Security Considerations

- No new auth surface.
