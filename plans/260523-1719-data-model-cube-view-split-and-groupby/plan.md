---
slug: data-model-cube-view-split-and-groupby
created: "2026-05-23T17:19:00.000Z"
completed: "2026-05-23T17:35:00.000Z"
status: complete
---

# Data Model catalog — split Cube/View filter + add Group-by

## Context links
- Tab: `src/pages/Catalog/data-model-tab/data-model-tab.tsx`
- Filter rail: `src/pages/Catalog/data-model-tab/data-model-filter-rail.tsx`
- Concept type: `src/pages/Catalog/data-model-tab/concept-types.ts`
- Concept derivation: `src/pages/Catalog/data-model-tab/use-concepts.ts`
- Filter/usage hook: `src/pages/Catalog/data-model-tab/use-filtered-concepts.ts`
- Meta source: `src/pages/Catalog/use-catalog-meta.ts` (`CatalogCube.type: 'cube'|'view'`)
- Shared primitives: `src/shared/filter-chip-bar/filter-chip-bar.tsx`, `src/shared/catalog-grouped-view/catalog-group-primitives.tsx`

## Overview
Data Model tab today (a) lumps cubes and views together in a single "Cube" pill row and (b) hard-codes the section grouping to concept Type. Users want:
1. **Filter split** — two pill rows: `Cube` (kind=cube only) and `View` (kind=view only).
2. **Group-by control** — a new pill row inside the filter rail. Axes:
   - Type *(default — current behaviour)*
   - Cube/View name
   - Source kind (Cube vs View)
   - Usage bucket (Heavy 5+ / Medium 1–4 / Unreferenced)
   - Aggregation type *(measures only; non-measures bucket as "—")*
   - Dimension type *(dimensions only; non-dimensions bucket as "—")*

User-confirmed decisions (`AskUserQuestion`, this session):
- Filter split → two rows.
- Group-by lives in filter rail (new row).
- Six group-by axes above; `cube` already exists as source name (no rename).

## Key insights
- `CatalogCube.type` already exists — no API/data work needed.
- `useConcepts` already iterates over cubes; just thread `cube.type` through into the new `cubeKind` field.
- `FilterPillRow` is a generic component — reusing it for `View` is trivial.
- Existing `groupByType()` returns `Map<ConceptType, Concept[]>` with `TYPE_ORDER`. Replace with a small spec module that returns `Array<{ key, label, items }>` in the right order per axis.

## Architecture

### Data
Extend `Concept`:
```ts
export interface Concept {
  type: ConceptType;
  cubeKind: 'cube' | 'view';   // new
  fqn: string;
  cube: string;                 // source name (cube OR view)
  ...
}
```

### Filters
Extend `ConceptFilters`:
```ts
export type GroupByKey =
  | 'type' | 'cube' | 'kind' | 'usage' | 'aggType' | 'dimensionType';

export interface ConceptFilters {
  types: Set<ConceptType>;
  cubes: Set<string>;   // source names where cubeKind === 'cube'
  views: Set<string>;   // source names where cubeKind === 'view'  ← new
  cdpProjectedOnly: boolean;
  unreferencedOnly: boolean;
  groupBy: GroupByKey;  // new — default 'type'
}
```
Filter logic in `use-filtered-concepts.ts`:
- `cubes.size > 0` narrows to cube-typed sources in that set.
- `views.size > 0` narrows to view-typed sources in that set.
- Together (e.g. one of each) → OR within source-name match.

### Grouping
New file `group-by-spec.ts`:
```ts
interface Group { key: string; label: string; items: Concept[]; }
function groupConcepts(items: Concept[], by: GroupByKey, usageMap): Group[];
```
Order rules:
- `type` → measure → dimension → segment
- `cube` → alphabetical
- `kind` → cube → view
- `usage` → Heavy (5+) → Medium (1–4) → Unreferenced (0)
- `aggType` → alphabetical (sum/count/avg/...); non-measure → "—" bucket last
- `dimensionType` → string/number/time/boolean alphabetical; non-dim → "—" bucket last

### UI
`data-model-filter-rail.tsx`:
- Add `availableViews` prop (already have `availableCubes`).
- Render rows in order: Type, Cube, View, Group by, Cross-reference toggles.
- Group-by row uses single-select (a new `FilterPillRow`-like helper or local pill button — simplest: reuse `Pill` directly inline since we already import from filter-chip-bar).

`data-model-tab.tsx`:
- Compute `availableCubes` and `availableViews` by splitting `cubes` on `c.type`.
- Replace `groupByType` + `TYPE_ORDER`/`TYPE_LABEL` with `groupConcepts(visible, filters.groupBy, usageMap)`.
- `selectAllInType` becomes `selectAllInGroup(groupKey, items, allSelected)` — keyed by group key, not concept type.

## Related code files
**Modify**
- `src/pages/Catalog/data-model-tab/concept-types.ts`
- `src/pages/Catalog/data-model-tab/use-concepts.ts`
- `src/pages/Catalog/data-model-tab/use-filtered-concepts.ts`
- `src/pages/Catalog/data-model-tab/data-model-filter-rail.tsx`
- `src/pages/Catalog/data-model-tab/data-model-tab.tsx`
- `src/pages/Catalog/data-model-tab/__tests__/use-concepts.test.ts`
- `src/pages/Catalog/data-model-tab/__tests__/use-filtered-concepts.test.ts`

**Create**
- `src/pages/Catalog/data-model-tab/group-by-spec.ts`
- `src/pages/Catalog/data-model-tab/__tests__/group-by-spec.test.ts`

**Delete** — none.

## Implementation steps
1. Add `cubeKind` to `Concept`; populate in `use-concepts.ts` from `cube.type ?? 'cube'`.
2. Create `group-by-spec.ts`: GroupByKey union, label maps, `groupConcepts(items, by, usageMap)` returning ordered `Group[]`.
3. Update `ConceptFilters` (+ `emptyConceptFilters`) with `views: Set<string>` and `groupBy: 'type'`.
4. Update `useFilteredConcepts`: apply views filter; re-export usageMap unchanged.
5. Update `data-model-filter-rail.tsx`: add View row, add Group-by single-select row.
6. Update `data-model-tab.tsx`: split sources by kind, swap `groupByType` → `groupConcepts`, update `selectAllInType` → `selectAllInGroup`.
7. Update existing tests; add new `group-by-spec.test.ts`.
8. Run `npx tsc --noEmit`; smoke run dev server.

## Todo
- [x] 1 — Extend Concept type with cubeKind + populate in use-concepts
- [x] 2 — Create group-by-spec module
- [x] 3 — Add views set + groupBy to ConceptFilters
- [x] 4 — Apply views filter in use-filtered-concepts
- [x] 5 — Render View row + Group-by row in filter rail
- [x] 6 — Swap groupByType for groupConcepts in tab; update selectAll
- [x] 7 — Tests pass (23/23 in data-model-tab/__tests__)
- [x] 8 — Typecheck: net –3 TS errors vs baseline (zero on touched files)

## Success criteria
- Cube filter row shows only sources where `cube.type !== 'view'`; View row shows only views.
- Group-by control offers all 6 axes; default 'type' reproduces today's UI byte-for-byte.
- Selecting Group by = Cube/View name renders one collapsible section per source, sorted alphabetically.
- `tsc --noEmit` clean.
- Existing tests still pass; new tests cover group-by-spec resolvers.

## Risk assessment
- **Low — UI only, no API change.**
- Aggregation-type / dimension-type axes produce a "—" bucket for non-applicable concepts — that's intentional (lets users see what's outside the axis), but worth verifying the empty bucket isn't visually confusing.
- `selectAllInGroup` keying: must derive a stable group-key string per concept that matches the section key, else "select all" misfires when group-by axis changes. The spec module returns the same `keyOf(concept, by)` used both at grouping and at toggle time — single source of truth.

## Security considerations
- None — purely client-side filter/UI state.

## Open questions
- For the "—" bucket on aggType/dimensionType: include a help affordance, or just label "—"? Default: bare "—".
- Hide empty groups by default? Default: yes (matches existing TYPE_ORDER behaviour).
