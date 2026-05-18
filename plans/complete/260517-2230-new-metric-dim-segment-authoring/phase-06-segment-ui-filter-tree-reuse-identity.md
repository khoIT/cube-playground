---
phase: 6
title: "Segment UI filter tree reuse identity"
status: completed
priority: P1
effort: "0.5d"
dependencies: [4]
---

# Phase 6: Segment UI filter tree reuse identity

## Overview

Wire segment-mode's middle step to the existing `FiltersBody` filter-tree component. No new builder UI — segment authoring is exactly "name a filter tree." YAML preview rail switches to segment section header. Done-flag requires at least one non-empty leaf in the tree.

## Requirements

- **Functional:**
  - Segment-mode Step 2 (after Source) renders `FiltersBody` from `step-4-filters/filters-body.tsx` with the segment-mode draft's `filterTree`.
  - Done-flag for this step = tree has ≥1 non-empty leaf (`flattenToSql` returns non-empty string).
  - YAML preview rail shows the segment YAML block live, with `sectionKey: 'segments'` header.
  - Continue advances to Identity step (shared with measure mode), which is reused as-is.
- **Non-functional:**
  - Filter tree component is shared between measure-mode Step 4 and segment-mode middle step. No fork.
  - Column dropdown in the tree is scoped to the **source cube only** (v1 single-cube segments).

## Architecture

```
full-page/steps/
└── step-segment-tree/
    └── segment-tree-body.tsx          (thin wrapper around FiltersBody)
```

`segment-tree-body.tsx` is essentially:

```tsx
<>
  <Header>Define cohort with WHERE clauses</Header>
  <FiltersBody cube={selectedCube} tree={draft.filterTree} onChange={(t) => setField('filterTree', t)} />
</>
```

## Related Code Files

- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-segment-tree/segment-tree-body.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — wire segment-mode step bodies.
- Modify: `src/QueryBuilderV2/NewMetric/full-page/hooks/use-active-step.ts` — done-flag for segment middle step: `!filterTreeIsEmpty(filterTree)`.
- Read for context: `step-4-filters/filters-body.tsx`, `filter-tree/index.ts` (exports `isEmpty`).

## Implementation Steps (TDD — tests first)

1. **Write failing test for done-flag:**
   - Empty filter tree → segment-mode middle-step `doneFlag === false`.
   - Single leaf with column + value → `doneFlag === true`.
   - Group with only empty leaves → `doneFlag === false`.
2. **Write failing test for YAML preview rail in segment mode:**
   - Filter tree `{ country = 'VN' }` → rail emits `segments:\n  - name: <name>\n    sql: "{CUBE}.country = 'VN'"`.
3. **Implement `segment-tree-body.tsx`** — thin wrapper, no logic beyond reading `draft.filterTree` and forwarding `onChange` to `setField('filterTree', ...)`.
4. **Wire in `NewMetricPage.renderStep`** — segment-mode middle step renders this body.
5. **Update `use-active-step.ts`** — segment-mode done-flag uses `!filterTreeIsEmpty(filterTree)`.
6. **Update YAML preview rail** — when `artifactKind === 'segment'`, call `generateEntry(draft)` and render the section header `segments:`.
7. **Manual end-to-end smoke** — create `vn_whales_v2` on `mf_users`: source → filter tree (country=VN AND ltv>=10M) → identity → test run (P7 placeholder) → submit. YAML lands in `cube.segments[]`, Cube `/meta` reflects.

## Success Criteria

- [ ] Done-flag tests green.
- [ ] YAML preview rail test green.
- [ ] Segment-mode middle step renders `FiltersBody` correctly — same UX as measure-mode Step 4.
- [ ] Column dropdown restricted to source cube only.
- [ ] Identity step works unchanged.
- [ ] Manual smoke: `vn_whales_v2` segment created and visible in Cube `/meta`.
- [ ] No regression on measure-mode Step 4 (still uses `FiltersBody` identically).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `FiltersBody` UX implies "filters applied to a measure" — confusing in segment mode | Step header copy: "Define cohort — these conditions become the segment's WHERE clause." Body internals unchanged. |
| User builds segment with single empty leaf, then Continue → done-flag passes but YAML emits empty SQL | `flattenToSql` already returns empty string for empty trees; P2's `generate-segment.ts` throws on empty. Done-flag must mirror that (test #1 above). |
| Filter tree references columns of other cubes (via cross-cube joins) | v1 segment scope is single-cube — column dropdown restricted via `useEligibleColumns(cube, 'all-dimensions')`. Cross-cube segments deferred. |
| Segment SQL with single-quote values double-escapes due to filter-tree quoting + generator quoting | Existing `flattenToSql` already handles quoting per the P1-rebuild plan's value-quoting rules. Generator passes the string through unchanged. Round-trip test in P2. |

## TDD Test Inventory

| Test | What it locks in |
|---|---|
| `segment done-flag false on empty tree` | Done-flag correctness |
| `segment done-flag true on non-empty leaf` | Done-flag correctness |
| `yaml preview rail emits segment block` | Rail integration |
| `column dropdown shows only source-cube columns` | Single-cube scope |
