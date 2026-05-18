---
phase: 3
title: "Sidebar member enrichment: tooltip aggType/format/cluster badge"
status: pending
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 3: Sidebar member enrichment — tooltip aggType/format/cluster badge

## Context Links

- ListMember (sidebar member row): `src/QueryBuilderV2/components/ListMember.tsx`
- Tooltip wrapper: `src/QueryBuilderV2/components/InstanceTooltipProvider.tsx`
- Cube card (sidebar cube row): `src/QueryBuilderV2/components/SidePanelCubeItem.tsx`
- Item info icon (description popover): `src/QueryBuilderV2/icons/ItemInfoIcon.tsx` (existing component)
- `/meta` field-population audit (this plan): description 21/59 measures, aggType 59/59, formatDescription 59/59, connectedComponent 4/11

## Overview

Wire already-loaded `/meta` fields into the existing sidebar UI. Two distinct surfaces:

- **Tooltip enrichment** — `InstanceTooltipProvider` is called with `description` undefined today (`ListMember.tsx:111` doesn't pass it). Pass it. Also accept and render `aggType` chip and `formatDescription` hint.
- **Cluster badge** — `SidePanelCubeItem` cube card header gains a small chip: "Joins to N cubes" (from `connectedComponent`) or "Standalone" (when undefined).

Tiny phase, runs parallel with P2.

## Priority

P1 — high-leverage cosmetic that exposes already-loaded data. Zero new fetches.

## Key Insights

- `ListMember.tsx:111-117` already wraps the row in `InstanceTooltipProvider` with `name`, `fullName`, `type`, `title`, but **NOT** `description`. The tooltip silently displays `undefined` in the description slot.
- `aggType` (59/59 populated) is the single highest-value field for the sidebar — answers "is this a count or a sum?" without clicking through.
- Per-measure abbreviation map keeps the chip tight (≈ 4–6 chars) so it fits in the existing row layout.
- `connectedComponent` is only present on 4/11 cubes (the joined cluster); views and isolated cubes have undefined. Render "Standalone" for undefined.

## Requirements

### Functional

**Tooltip:**
- `InstanceTooltipProvider` accepts new optional props: `aggType?: string`, `formatDescription?: { name: string; specifier?: string }`.
- Tooltip body adds a row for aggType (when present): `≈ Cnt-D` / `Σ` / `Cnt` etc.
- Tooltip body adds a row for format hint (when present): `Currency · ,.2~f` / `Number · ,.2~f`.
- `ListMember` passes `description={member.description}` AND the new `aggType` / `formatDescription` props.

**Cluster badge:**
- `SidePanelCubeItem` cube header renders a small chip immediately after the cube title:
  - `cube.connectedComponent` defined → `Joins to N cubes` (N derived from the join graph already built in P1 via `useReachableMembers(cube.name)`)
  - `cube.connectedComponent` undefined → `Standalone`
- Chip styling matches existing `CountBadge` / `Badge` patterns in `QueryBuilderSidePanel.tsx`.

### Non-functional
- No new fetches. All data already in `cubes` state after P1.
- aggType abbreviation map lives in a tiny standalone util.

## Architecture

```
loadMeta() ─▶ cubes[] (with joins + connectedComponent + measure.aggType + measure.formatDescription)
                │
                ├─▶ ListMember
                │    └─ InstanceTooltipProvider(description, aggType, formatDescription)
                │
                └─▶ SidePanelCubeItem
                     └─ ClusterBadge(connectedComponent, joinedCubeCount)
```

## Related Code Files

- **Modify:**
  - `src/QueryBuilderV2/components/InstanceTooltipProvider.tsx` — add `aggType` + `formatDescription` props, render in tooltip body
  - `src/QueryBuilderV2/components/ListMember.tsx:111-117` — pass `description`, `aggType`, `formatDescription` to provider
  - `src/QueryBuilderV2/components/SidePanelCubeItem.tsx` — add ClusterBadge in cube header
- **Create:**
  - `src/QueryBuilderV2/utils/agg-type-label.ts` — small abbreviation map (≈ 10 lines)
- **Read for context:**
  - `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` — `CountBadge` styling pattern

## Implementation Steps

1. Create `agg-type-label.ts`:
   ```ts
   export const AGG_TYPE_LABEL: Record<string, string> = {
     count: 'Cnt',
     countDistinct: 'Cnt-D',
     countDistinctApprox: '≈ Cnt-D',
     sum: 'Σ',
     avg: 'Avg',
     min: 'Min',
     max: 'Max',
     number: 'ƒx',
   };
   export function labelForAggType(aggType?: string): string | null {
     return aggType ? (AGG_TYPE_LABEL[aggType] ?? aggType) : null;
   }
   ```
2. Update `InstanceTooltipProvider`:
   - Add `aggType?: string` and `formatDescription?: { name?: string; specifier?: string }` to props
   - In the TooltipWrapper body, after `<div data-element="Description">{description}</div>`, append two new conditional rows for aggType and formatDescription (only render when defined)
   - Format hint string: `${formatDescription.name}${formatDescription.specifier ? ' · ' + formatDescription.specifier : ''}`
3. Update `ListMember.tsx:111`:
   - Pull from member: `const aggType = 'aggType' in member ? member.aggType : undefined; const formatDescription = 'formatDescription' in member ? member.formatDescription : undefined;`
   - Pass all four (`description`, `aggType`, `formatDescription`) to `InstanceTooltipProvider`
4. Update `SidePanelCubeItem.tsx`:
   - Import `useReachableMembers` to derive joinedCubeCount
   - In cube header (around line 147 where `title, description` are destructured), insert a small Badge: `<ClusterBadge cube={cube} />`
   - `ClusterBadge` inline functional component — single tasty styled chip; reads `cube.connectedComponent` and joined-cube count
5. Smoke test:
   - Hover any measure in QueryBuilder sidebar → tooltip shows description + aggType chip + format
   - Cube cards for `mf_users`, `active_daily`, `recharge`, `user_recharge_daily` show "Joins to N cubes"
   - View cards (`user_profile`, etc.) show "Standalone"

## Todo List

- [ ] Create `agg-type-label.ts` util
- [ ] Add `aggType` + `formatDescription` to `InstanceTooltipProvider` props + render
- [ ] Pass `description`, `aggType`, `formatDescription` from `ListMember` to provider
- [ ] Add ClusterBadge to `SidePanelCubeItem` header
- [ ] Smoke: hover `active_daily.dau` → tooltip shows description, "≈ Cnt-D" chip, format hint
- [ ] Smoke: cube cards correctly badged (4 cubes vs 7 standalone)

## Success Criteria

- [ ] Every measure tooltip in the sidebar surfaces description (when present) + aggType + format
- [ ] Every cube card header shows cluster membership ("Joins to N cubes" or "Standalone")
- [ ] No regression on existing sidebar interactions (selection, add/remove, search)
- [ ] No new network requests

## Risk Assessment

- **Risk:** Tooltip width regression — adding 2 more rows may push width past existing layouts. Mitigation: rows are short; existing `width="max-content"` accommodates.
- **Risk:** `connectedComponent` value mismatch between cubes (e.g. orphan cluster of 2). Mitigation: check live data — current state is 4 cubes all in `connectedComponent: 1`, no orphan clusters. Re-verify if cube model grows.
- **Risk:** `formatDescription.specifier` exposes internals like `,.2~f` which are jargon. Mitigation: showing the raw specifier IS the demo value — DAs recognize d3-format syntax. Friendly rephrasing is a polish item.

## Security Considerations

- None. Pure-display surface over already-loaded data.
