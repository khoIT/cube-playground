---
phase: 1
title: "Foundation projection mapper and types"
status: complete
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Foundation projection mapper and types

## Overview

Build the pure, deterministic core: types describing the CDP `Metric` payload, the projection result discriminated union, and a `projectMeasure(cube, measure)` mapper implementing Â§3.3 of the architecture doc. TDD throughout â€” every measure shape gets a unit test before the mapping branch lands.

## Requirements

### Functional
- `projectMeasure` accepts a `CatalogCube` + a single `Measure` (from extended `/meta`) and returns either:
  - `{ ok: true, payload: CdpMetricPayload }` for projectable measures
  - `{ ok: false, reason: NotProjectableReason }` for the rest
- `CdpMetricPayload` matches MM-01-CRUD `CreateMetricRequest` shape (excluding `materialize`/`schedule` which default empty/false).
- Mapping branches:
  - `count` â†’ `expression: "COUNT(*)"`, `filter: ""`
  - `sum, sql: x` â†’ `expression: "SUM(x)"`, `filter: ""`
  - `count_distinct, sql: x` â†’ `expression: "COUNT(DISTINCT x)"`, `filter: ""`
  - `count_distinct_approx, sql: x` â†’ `expression: "approx_distinct(x)"`, `filter: ""`
  - any agg w/ `filters: [{sql: P1}, {sql: P2}â€¦]` â†’ `filter: "(P1) AND (P2) â€¦"`
  - `number` type with `{measure_ref}` placeholders â†’ `notProjectable("references-other-measures")`
  - measure on a multi-cube view / segment-only â†’ `notProjectable("not-single-source")`
- `dimensions[]` = sort + dedup of `cube.dimensions[].name` (column-name only, no cube prefix) where `public !== false` and `primaryKey !== true`.

### Non-functional
- Pure (no fetch, no React, no IO). 100% test coverage on branches.
- File length â‰¤ 200 lines per file.
- No `any` in public types; use `unknown` where shape isn't certain (Cube meta envelope is loose).

## Architecture

```
cdp-projection/
  types.ts                  â—„â”€â”€ new
  project-measure.ts        â—„â”€â”€ new (pure)
  __tests__/
    project-measure.test.ts â—„â”€â”€ new (written FIRST)
```

### `types.ts` (excerpt)

```ts
export type CdpMetricPayload = {
  game_id: string;
  metric_name: string;
  metric_codename: string;
  source: string;          // FQN: <catalog>.<schema>.<table>
  expression: string;      // SQL scalar
  dimensions: string[];    // sorted column names
  filter: string;          // "" when none
};

export type NotProjectableReason =
  | 'references-other-measures'
  | 'not-single-source'
  | 'missing-cube-meta'
  | 'unsupported-agg-type';

export type ProjectionResult =
  | { ok: true; payload: CdpMetricPayload }
  | { ok: false; reason: NotProjectableReason; detail?: string };

export type VerifyState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'missing' }
  | { kind: 'mismatch'; diff: Array<{ field: string; expected: unknown; actual: unknown }> }
  | { kind: 'error'; message: string };
```

### `project-measure.ts` (sketch)

```ts
export function projectMeasure(cube: CatalogCube, measure: Measure): ProjectionResult {
  if (!cube.meta?.game_id || !cube.meta?.cdp_source) {
    return { ok: false, reason: 'missing-cube-meta' };
  }
  if (referencesOtherMeasures(measure)) {
    return { ok: false, reason: 'references-other-measures' };
  }
  // â€¦ per-agg-type switch
}
```

## Related Code Files

- **Create:**
  - `src/pages/Catalog/cdp-projection/types.ts`
  - `src/pages/Catalog/cdp-projection/project-measure.ts`
  - `src/pages/Catalog/cdp-projection/__tests__/project-measure.test.ts`
- **Read (context):**
  - `src/pages/Catalog/use-catalog-meta.ts` â€” for `CatalogCube` / `Measure` shapes
  - `plans/reports/architecture/cube-vs-cdp-metrics-architecture.md` Â§3.3 â€” for canonical mapping table
  - `C:\Users\CPU12830-local\code\cube-dev\cube\model\cubes\mf_users.yml` â€” to enumerate real measure shapes
- **Modify:** none
- **Delete:** none

## Implementation Steps (TDD)

1. **Test first** â€” write `project-measure.test.ts` with these cases:
   - `count` â†’ expected payload shape
   - `sum, sql: amount` â†’ `SUM(amount)`
   - `count_distinct, sql: user_id` â†’ `COUNT(DISTINCT user_id)`
   - `count_distinct_approx, sql: user_id` â†’ `approx_distinct(user_id)`
   - `sum, sql: amount, filters: [{sql: 'is_paying=true'}]` â†’ expression `SUM(amount)`, filter `(is_paying=true)`
   - `sum` w/ 2 filters â†’ `filter: "(p1) AND (p2)"`
   - `number, sql: "{a}/{b}"` â†’ `{ ok: false, reason: 'references-other-measures' }`
   - cube without `meta.game_id` â†’ `{ ok: false, reason: 'missing-cube-meta' }`
   - dimensions sorted + filtered to `public !== false && !primaryKey`
   - empty filters array treated same as no filters
2. Run tests â†’ all red.
3. Write `types.ts`.
4. Write `project-measure.ts` covering each branch in test order.
5. Run tests â†’ all green.
6. Verify file sizes â‰¤ 200 lines via `wc -l`.
7. Run `npm run typecheck` â€” no `any` leakage.

## Success Criteria

- [ ] `project-measure.test.ts` has â‰¥ 10 cases, all green
- [ ] `types.ts` exports `CdpMetricPayload`, `NotProjectableReason`, `ProjectionResult`, `VerifyState`
- [ ] `project-measure.ts` has no React / fetch / global imports â€” pure module
- [ ] `npm run typecheck` clean
- [ ] All new files â‰¤ 200 lines
- [ ] No `any` in public types

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `CatalogCube` / `Measure` shape from extended `/meta` doesn't carry `meta` field | Read existing `use-catalog-meta.ts`; if missing, type widening is part of P3 â€” P1 uses a local extended type and accepts the shape gap |
| Trino-specific `approx_distinct` vs Postgres dialect | MM-01 source is opaque SQL â€” projection just emits the literal Cube `type` â†’ SQL fn name; consumer of CDP decides dialect |
| Calculated measure detection brittle (string match on `{`) | Use a regex `/\{[a-zA-Z_]\w*\}/`; covered by tests including no-false-positive case |
| Filter SQL contains `AND` literal that confuses join | Always wrap each filter in parens `(P1) AND (P2)`; tested explicitly |
