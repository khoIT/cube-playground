---
phase: 5
title: "Step 4 Filters — AND/OR group builder + Visual/SQL/Both + cohort funnel (runIdRef)"
status: completed
priority: P1
effort: "2d"
dependencies: [4]
---

# Phase 5: Filters step and-or tree cohort funnel

## Overview

Step 4 — AND/OR group filter UX on top of P1 filter-tree. Three view modes (Visual / SQL / Both) via segmented control. Visual mode renders recursive group/leaf tree with add-condition + add-OR-group + remove + drag-handle (no reorder this phase). SQL mode shows live `flattenToSql` output in a syntax-highlighted code block. `use-cohort-funnel` hook fires progressive row-count queries for the right rail. Skip step keeps metric population-wide. Optional step (no validation card increment).

**Red-team-applied (finding #4):** **`use-cohort-funnel` uses `runIdRef` stale-token guard** (matches `use-funnel-queries.ts:57-78`), not `AbortController`. Pending in-flight requests complete but stale `setState` is skipped.

**Red-team-applied (finding #14):** Funnel base count + progressive counts gate on `<cube>.count` measure. When absent, funnel renders "Base count unavailable" empty state; SQL view + visual builder still work.

**Red-team-applied (finding #12):** Filter values flow through P1 `flattenToSql` → strict type-aware quoting (`O''Brien` style escape, control-byte reject). Tested via P1 property tests.

## Requirements

**Functional:**
- Visual builder shows root group (default `op: 'AND'`, empty children). User adds:
  - **Condition** (leaf) — column dropdown (constrained to source-cube dimensions + string columns via `useEligibleColumns(sourceCube, 'all-dimensions')`); op pill (`=`, `IN`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `startsWith`, `set`, `notSet`); values input (chips for IN; single token otherwise; boolean → toggle; date → reuse antd `DatePicker`).
  - **OR group** — nested group with `op: 'OR'`, can hold leaves only (no deeper nesting in P5).
  - **Time range** — optional `previewTimeFilter` chip; not part of `filterTree` but tracked in draft (used in test-run P7).
- Segmented control toggles `state.filterMode = 'visual' | 'sql' | 'both'`. In `both`, visual on top, SQL fragment under it.
- SQL view: read-only.
- AND/OR seg control inside each group toggles `op`.
- Remove button per leaf + per nested group.
- Add condition inserts the first available preset from `FILTER_PRESETS` (per-cube list, e.g. `tier IN ('premium','whale')`) when root has zero children; blank leaf otherwise.
- Right-rail **Cohort Impact** panel:
  - "Population funnel": baseline row count of source cube → progressive count after each top-level child applied (AND'd up to that child) → final cohort count + % of source.
  - "Result preview" card: op-applied value over final cohort (mocked w/ "estimated" tag until P7 wires real test-run write-then-load).
- `use-cohort-funnel(cube, filterTree)` — debounced 400 ms, **runIdRef stale-token guard**, parallel queries for each prefix of root-level children. Each query: `{ measures: ['<cube>.count'], filters: <flattened prefix> }`. Top-level AND prefixes only in P5; deeper OR groups treated as single leaf in the funnel.
- Funnel cache key = `JSON.stringify(canonicalize(filterTree))` where `canonicalize` sorts group children by stable id; prevents re-fire on identical-meaning trees.
- Base count cached per source cube; 5-min TTL.
- LeftRail step row 4 summary: `${state.filterTree.children.length} cond · AND|OR`; badge: count if > 0.
- Validation: Filters do NOT increment the 4/4 count (mockup parity).
- StepFooter shows Skip step button + Back/Continue. Continue label: "Continue to identity".

**Non-functional:**
- Visual builder recursive but capped to 1 nesting level in P5.
- Hooks debounce + stale-guard robust under rapid edits.
- All files < 200 LOC.
- No `AbortController` / `AbortSignal` (Cube SDK doesn't support).
- No `dangerouslySetInnerHTML`.

## Architecture

```
src/QueryBuilderV2/NewMetric/full-page/
├── steps/step-4-filters/
│   ├── index.tsx
│   ├── filters-body.tsx                  seg control + visual + sql
│   ├── visual-builder.tsx                recursive renderer for FilterNode tree
│   ├── filter-leaf-row.tsx               column + op + values + remove
│   ├── filter-group-block.tsx            OR-group wrapper around leaves
│   ├── filter-sql-view.tsx               read-only highlighted SQL block (uses React text nodes for tokens — no innerHTML)
│   ├── filter-presets.ts                 per-cube common presets
│   ├── cohort-impact-rail.tsx            funnel + result preview
│   └── __tests__/
│       ├── filter-leaf-row.test.tsx
│       └── visual-builder.test.tsx
└── hooks/
    ├── use-cohort-funnel.ts              runIdRef + debounce
    └── __tests__/
        └── use-cohort-funnel.test.ts
```

## Related Code Files

- **Create:** all files above
- **Modify:** `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — render step-4 when `currentStep === 4`
- **Reuse:** `filter-tree/*` from P1 (`addLeaf`, `removeNode`, `setGroupOp`, `flattenToSql`)
- **Reference for pattern:** `src/QueryBuilderV2/analysis/use-funnel-queries.ts:57-78` (runIdRef pattern)

## Implementation Steps (TDD)

1. **Write tests first:**
   - `use-cohort-funnel.test.ts` — given a 3-leaf AND tree, returns 4 rows (base + 3 progressive). Mock `cubejsApi.load` returning increasing counts. Debounce: rapid edits within 400 ms fire one network round. **Stale-token:** rapid edits at 200 ms cadence (faster than debounce) — each kicks runIdRef; final result is from final tree state; prior promises' setState skipped. Cube without count measure → returns `{ unavailable: true }` without queries.
   - `filter-leaf-row.test.tsx` — op `IN` switches values to multi-chip; `set`/`notSet` hides values input; boolean → toggle; date → `<DatePicker>`.
   - `visual-builder.test.tsx` — root renders children; add-condition appends leaf; toggle root op changes `state.filterTree.op`; nested OR renders inside root AND; add-group-inside-OR is disabled w/ tooltip.
2. **Implement `use-cohort-funnel`** — debounced + runIdRef + canonicalize cache key. Each progressive query: `{ measures: ['<cube>.count'], filters: <flattened prefix via flattenToSql> }`.
3. **Implement `filter-leaf-row`** — column dropdown (driven by `useEligibleColumns(sourceCube, 'all-dimensions')`); op pill; values input (chips for IN, single token otherwise). Boolean → toggle; date → antd `DatePicker`. Type-aware coercion delegated to `flattenToSql`.
4. **Implement `filter-group-block`** — wraps leaves; AND/OR seg control inside; add-condition + add-OR-group buttons (top level only).
5. **Implement `visual-builder`** — recursive renderer w/ 1-level cap; reject add-group-inside-OR via disabled button + tooltip "deeper nesting deferred".
6. **Implement `filter-sql-view`** — calls `flattenToSql(state.filterTree, columnTypeMap)`; renders inside `<pre>` w/ token coloring via React text nodes inside coloured `<span>`s (no innerHTML).
7. **Implement `cohort-impact-rail`** — funnel rows (label + bar + count), final cohort summary, result preview card with "estimated" badge. When `use-cohort-funnel` returns `unavailable`, render "Base count unavailable" empty state.
8. **Implement `filters-body`** — segmented control wiring + render based on mode.
9. **Wire step `index.tsx`** — Skip step in StepFooter advances without writing a filter.
10. **Manual QA on `mf_users`** — add `tier IN ('premium', 'whale')`, add `country = 'VN'`, observe funnel collapse each step in right rail; switch to a cube without count → "Base count unavailable" + funnel hidden.
11. Typecheck + tests + commit.

## Success Criteria

- [ ] Step 4 renders visual builder with default empty AND root.
- [ ] Add condition inserts a leaf; column dropdown shows source-cube dimensions; op pill switches; values chip input works for IN.
- [ ] Add OR group inserts a nested OR sub-group (1 level only); nested adds disabled inside it.
- [ ] Root AND/OR toggle changes `state.filterTree.op`; SQL view updates live.
- [ ] SQL view shows `flattenToSql` output w/ token coloring via React text nodes (no innerHTML).
- [ ] `use-cohort-funnel` fires progressive counts; rapid edits debounced; **stale-token verified** (asserts skipped `setState` on prior runId).
- [ ] Right rail shows base → step-by-step counts → final cohort + %.
- [ ] Cube without count measure → "Base count unavailable" empty state; visual + SQL still work.
- [ ] Skip step button advances to Step 5 without modifying filterTree.
- [ ] Both mode shows visual + SQL stacked.
- [ ] LeftRail Step 4 summary updates to condition count + root op.
- [ ] No `AbortController`, no `dangerouslySetInnerHTML` in new files.
- [ ] Typecheck + tests green; every new file < 200 LOC.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Cohort funnel queries flood Cube on rapid edits | 400 ms debounce + runIdRef stale-token. Skip funnel update while user actively typing in a chip input. |
| Deep nested AND/OR trees blow up the UI | Cap at 1 nesting level in P5; document. Defer raw SQL editor to later. |
| Identical-meaning trees re-fire queries | Canonicalize cache key — sort group children by stable id before JSON.stringify. |
| `flattenToSql` value-quoting mistake exposes injection in client preview AND in YAML on disk | Property tests in P1 cover quoting + escape; deny-list runs on every emitted `sql:` string per P1 spec. |
| Boolean / date columns mishandled in leaf row UI | Type-specific input components; per-type tests. |
| Funnel base count slow on large cubes | Cached per-source-cube; 5-min TTL. |
| `filter-presets.ts` per-cube hardcoded list rots when meta changes | Soft suggestions; hidden if columns absent in current meta. |
| Cube without count measure breaks funnel entirely | Gate `use-cohort-funnel`; "Base count unavailable" empty state; user can still build filters + see SQL + submit. |
