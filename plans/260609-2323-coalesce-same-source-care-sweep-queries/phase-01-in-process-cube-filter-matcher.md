---
phase: 1
title: "In-process Cube-filter matcher"
status: pending
priority: P1
effort: "2.5h"
dependencies: []
---

# Phase 1: In-process Cube-filter matcher

## Overview

A pure function `matchesCubeFilters(row, filters, anchorDate?)` that decides whether
one Cube result row satisfies a translated `CubeFilter[]` — the in-process equivalent
of Cube applying those filters in SQL. This is the foundation the coalesced sweep
filters each playbook with. Built and proven in isolation, oracle = real Cube
operator semantics.

## Requirements

**Functional**
- `matchesCubeFilters(row: Record<string, unknown>, filters: CubeFilter[]): boolean`
  — top-level array is implicit AND (matches `treeToCubeFilters` root contract).
- Recurse `{ and: [...] }` (all) and `{ or: [...] }` (any) logical filters.
- Leaf operator semantics mirroring Cube for the full 16-op set (post-translation
  some collapse: `in`→`equals` multi-value, `notIn`→`notEquals` multi-value):
  - `equals` / `notEquals`: row value ∈ / ∉ `values` (string compare; multi-value = IN/NOT-IN).
  - `gt` / `gte` / `lt` / `lte`: **numeric** compare (`Number()` both sides).
  - `contains`: substring (case-insensitive, as Cube does) against any value.
  - `set` / `notSet`: value is non-null / null (no `values`).
  - `inDateRange` / `notInDateRange`: row date ∈ / ∉ `[start, end]` (inclusive
    start, **exclusive end at day granularity** — match Cube; assert in tests).
  - `beforeDate` / `afterDate`: row date `<` / `>` the single value.
- **Operator-family coercion** (the parity surface): comparison kind is chosen by
  operator, not by a lost `type` field — gt/gte/lt/lte → Number; date ops → Date;
  equals/in/contains/set → string. Document why (CubeLeafFilter drops `type`).

**Non-functional**
- Pure, no I/O, no Cube import. `null`/`undefined` handled per-operator (a `gte` vs
  null → false; `notSet` vs null → true). No throw on unknown operator — but a new
  op MUST be added consciously (default branch logs + returns false, fail-closed).

## Architecture

New file `server/src/care/cohort-filter-matcher.ts` (~120 LOC). Operates on the
**already-translated** `CubeFilter`/`CubeLeafFilter` shapes from
`types/predicate-tree.ts`. Date-range bounds arrive **already expanded** by
`treeToCubeFilters` (relative windows, anniversary OR), so this module never does
relative-date math — it only compares a concrete row value against concrete bounds.
That is the deliberate parity-narrowing decision from `plan.md`.

```
matchesCubeFilters(row, filters)            // AND over array
  └─ matchesOne(row, filter)
       ├─ {and:[…]} → every(matchesOne)
       ├─ {or:[…]}  → some(matchesOne)
       └─ leaf      → matchLeaf(row[member], op, values)
                        ├─ numeric ops  → Number(a) ⋈ Number(b)
                        ├─ date ops     → Date(a) ∈/∉ [start,end) | < | >
                        └─ string ops   → String(a) equals/contains/in …
```

## Related Code Files

- Create: `server/src/care/cohort-filter-matcher.ts`
- Create: `server/test/cohort-filter-matcher.test.ts`
- Read (oracle, do NOT modify): `server/src/services/translator.ts`,
  `server/src/types/predicate-tree.ts`

## Implementation Steps

1. **TDD-first** — `cohort-filter-matcher.test.ts`, one block per operator. Each case:
   build a `LeafNode`, run it through `treeToCubeFilters(...)` to get the *real*
   translated filter, then assert `matchesCubeFilters(row, filters)` agrees with the
   intended truth for representative rows. This binds the matcher to translator output,
   not to a hand-written filter shape.
   - Numeric: `gte 1_000_000` → row 999_999 false, 1_000_000 true, 2_000_000 true; null false.
   - Multi-value `in` (translates to `equals` w/ N values): membership both ways.
   - `set`/`notSet`: null vs present.
   - `contains`: case-insensitive substring; non-match.
   - `inDateRange` with a **relative window** ("last 7 days") expanded via `anchorDate`:
     row inside window true, day before false; assert the start-inclusive/end-exclusive
     boundary explicitly.
   - `notInDateRange`: exact negation of the same window (no double-negation gaps).
   - Nested `{or:[…]}` inside top-level AND (the anniversary shape): any-branch match.
   - Empty filter array → matches everything (degenerate AND) — but note Phase 2's
     fail-closed guard skips empty-predicate playbooks before this is reached.
2. Implement `matchesCubeFilters` + `matchLeaf` per the architecture. Keep each
   operator branch a one-liner; centralize coercion helpers (`asNum`, `asDate`, `asStr`).
3. Run the matcher over **anniversary** translated output (OR of milestone single-day
   ranges) to confirm a date in any milestone window matches — milestone *attribution*
   stays in the sweep (Phase 2), but membership must be correct here.
4. tsc + `vitest run test/cohort-filter-matcher.test.ts` green.

## Success Criteria

- [ ] Matcher agrees with translated-filter intent across all 16 operators incl. null rows.
- [ ] `inDateRange` boundary semantics asserted (start-inclusive / end-exclusive) and
      match Cube's behaviour (verify against an existing translator/date test if one exists).
- [ ] `notInDateRange` is the exact negation of `inDateRange` over the same window.
- [ ] Unknown/unhandled Cube operator → fail-closed (false + warn), never throws.
- [ ] Pure: no Cube/DB import; file < 200 LOC.

## Risk Assessment

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Operator coercion diverges from Cube (string vs numeric compare) | M×H | Operator-family coercion + per-op tests driven through `treeToCubeFilters` |
| Date boundary off-by-one (inclusive/exclusive) | M×H | Explicit boundary test rows; pin the rule and document it |
| Lost `type` field causes wrong compare | M×M | Choose compare by operator family, not type; test numeric-stored-as-string rows |
| Future new operator silently mismatches | L×M | Default branch fail-closed (false + warn), not a silent true |
