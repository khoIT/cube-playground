---
phase: 3
title: "Step 2 Operation — 9 operation cards (Custom SQL dropped)"
status: completed
priority: P1
effort: "0.5d"
dependencies: [2]
---

# Phase 3: Operation step (no custom SQL)

## Overview

Build Step 2 — operation picker. **9 operation cards** (Sum, Count, Count distinct, Average, Min, Max, Median, Percentile, Ratio). **Custom SQL operation DROPPED per red-team finding #24** — client-side deny-list was theater (case games, comment padding, Unicode bypass) and no reviewer flow exists downstream to back a "review required" badge. Users wanting custom SQL edit YAML directly.

Segmented Common / All / Advanced filter. Right rail shows formula + eligible columns + optional "don't use for" callout.

## Requirements

**Functional:**
- 9 operations as `OPERATIONS` constant in `operations.ts`: id, name, icon, formula, description, accepts (column-type filter for Step 3), example string, `pro: true` for Median + Percentile.
- Filter segmented control:
  - **Common** → ops without `pro` (Sum, Count, Count distinct, Average, Min, Max, Ratio).
  - **All** → every op (default).
  - **Advanced** → only `pro: true` (Median, Percentile).
- 2-col grid of operation cards. Card: icon, name, formula chip (mono), description, eligible-cols count from `useEligibleColumns(sourceCube, op)`, example text, Selected pill when active, Advanced pill when `pro`.
- Right-rail content (op selected): header card (icon + name + formula), eligible columns list (first 6), "Don't use for" callout for `Sum` (text from mockup).
- Selecting an op invalidates `column` field (set to null) so Step 3 starts fresh.
- LeftRail step row 2 summary line updates to operation name; badge shows first 4 chars of name (mockup style).
- Continue disabled until op selected; `Count` permits skipping column step (special-cased in P4 nav — emit short note in left-rail "Skip column — count is *").
- StepFooter Continue label changes to "Pick column" (or "Skip column — count is *" for Count).

**Non-functional:**
- `operations.ts` keeps the 9-op constant; single source of truth.
- Card component reused across Common/All/Advanced segments.
- No `dangerouslySetInnerHTML`.

## Architecture

```
src/QueryBuilderV2/NewMetric/full-page/steps/step-2-operation/
├── index.tsx                             wires Shell w/ body + rail
├── operation-body.tsx                    seg control + 2-col grid
├── operation-card.tsx                    ≈ 90 LOC
├── operation-detail-rail.tsx             right-rail content
├── operations.ts                         9-op constant (NO custom)
└── __tests__/
    ├── operation-card.test.tsx
    └── operations.test.ts                 segment filtering
```

## Related Code Files

- **Create:** all files above
- **Create:** `src/QueryBuilderV2/NewMetric/full-page/hooks/use-eligible-columns.ts` + test
- **Modify:** `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — render step-2 when `currentStep === 2`
- **Modify:** `src/QueryBuilderV2/NewMetric/types.ts` — extend `Operation` type to add `'median' | 'percentile'` (NO `'custom'`). The `OPERATION_TYPE` map (`Partial<Record<Operation, string>>` from P1) accepts the new keys without forcing v1 emitter changes.

## Implementation Steps (TDD)

1. **Write tests first:**
   - `operations.test.ts` — filtering: Common excludes Median + Percentile; Advanced includes only those two. All segment returns 9.
   - `operation-card.test.tsx` — renders name + formula + description; click fires `onClick`; `selected=true` shows Selected pill + brand bg.
   - `use-eligible-columns.test.ts` — given a cube w/ mixed types and a numeric-only op, returns only numeric/integer columns; `accepts: 'all'` returns everything; `accepts: '2-measures'` returns only `kind === 'measure'`.
2. **Implement `operations.ts`** — 9 ops + categories + accepts list. Verify NO `'custom'` entry exists.
3. **Implement `use-eligible-columns.ts`** — pure derivation from meta + cube id + op `accepts`. Memoise.
4. **Implement OperationCard** — pixel-match the mockup card (formula chip, eligible-cols footer line, optional example).
5. **Implement OperationBody** — segmented control state local to step; 2-col grid; empty state when zero in segment.
6. **Implement OperationDetailRail** — header card + eligible-cols list + Sum's "don't use for" callout.
7. **Wire NewMetricPage** — pass cube, op, setOp; step-2 invalidates column on op change.
8. **Hook into LeftRail** — step row 2 summary + badge; validation count rises 1 → 2 once op picked.
9. **Manual QA** — click each op, segment switch hides/shows correct subset, Continue label changes per op, no Custom SQL card visible.
10. Typecheck + tests + commit.

## Success Criteria

- [ ] Step 2 renders **9** operation cards (Common / All / Advanced segmented). No Custom SQL card.
- [ ] Right rail updates on op selection with formula + eligible columns + Sum's "don't use for" callout.
- [ ] LeftRail Step 2 row shows op name + 4-char badge; validation 2/4 once op picked.
- [ ] Continue label "Pick column" (or "Skip column — count is *" for Count) — navigates to Step 3 placeholder.
- [ ] Changing op resets `draft.column` to null.
- [ ] No `'custom'` value emitted to YAML anywhere; grep `customSql` in new tree returns zero matches.
- [ ] Typecheck + tests green; every new file < 200 LOC.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Cube `meta` doesn't expose column types reliably | `useNewMetricMeta` extended payload (P1) populates types; `useEligibleColumns` falls back to "show all" when type undefined. |
| Median / Percentile not natively supported by Cube YAML measure types | Map to `type: number` w/ pre-written `sql:` template (`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x)`) — generated in emitter, decided in P1 emitter extension. Otherwise warn user at submit. |
| Adding `'median' | 'percentile'` to `Operation` breaks v1 emitter typecheck | P1 already relaxed `OPERATION_TYPE` to `Partial<Record<Operation, string>>` — new keys legal without forcing v1 changes. |
