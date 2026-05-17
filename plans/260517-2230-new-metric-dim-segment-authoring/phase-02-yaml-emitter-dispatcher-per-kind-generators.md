---
phase: 2
title: "YAML emitter dispatcher per-kind generators"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: YAML emitter dispatcher per-kind generators

## Overview

Factor today's `yaml/generate-measure-yaml.ts` into a kind-aware dispatcher plus three per-kind generators. Each generator returns `{ yaml, fragment, sectionKey }` so the splicer (P3) and the YAML preview rail (P8) know which top-level Cube section to render. Pure module work, no UI.

## Requirements

- **Functional:**
  - Dispatcher `generateEntry(draft, ctx)` picks `generate-measure` / `generate-dimension` / `generate-segment` from `draft.artifactKind`.
  - `generate-measure.ts` = existing logic, factored out, no behavior change.
  - `generate-dimension.ts` covers 4 sub-kinds (banding, time-since, passthrough, boolean) with correct Cube YAML shapes.
  - `generate-segment.ts` reuses `flattenToSql(filterTree, sourceCube)` from existing `filter-tree/`, emits `{ name, sql, description? }`.
  - Each generator emits the shared `meta:` block (source, author, created_at, grain, visibility, tags) with stable key order.
- **Non-functional:**
  - Round-trip safe: `parse(emit(input))` reproduces the input semantically (whitespace tolerant).
  - Existing `generate-measure-yaml.test.ts` / `generate-measure-yaml-v2.test.ts` stay green.

## Architecture

```
yaml/
├── generate-cube-entry.ts     (NEW — dispatcher, exports generateEntry)
├── generate-measure.ts        (MOVED from generate-measure-yaml.ts)
├── generate-dimension.ts      (NEW)
├── generate-segment.ts        (NEW)
└── infer-naming-convention.ts (unchanged)
```

### SQL template form per kind (red-team F-2)

Cube accepts two template forms in `sql:` strings. The wizard MUST emit the correct form per use-site or Cube silently resolves to the wrong column (the bug `generate-measure-yaml.ts:91-107` migrated away from).

| Use site | Form | Rationale |
|---|---|---|
| Banding `case.when[].sql` (P2 banding emitter) | `{CUBE}.<raw_column>` | The new dim being authored is not yet a Cube member; references are to underlying SQL columns. |
| Time-since `sql: DATE_DIFF(...)` (P2 time-since emitter) | `{CUBE}.<raw_column>` | Same reason — references the underlying time column directly. |
| Boolean `sql: CASE WHEN ... THEN TRUE ELSE FALSE END` (P2 boolean emitter) | `{CUBE}.<raw_column>` | Same. |
| Passthrough `sql:` (P2 passthrough emitter) | raw `<column_name>` (no template) | Cube interprets bare SQL identifiers as columns of the underlying `sql_table`. Matches `mf_users.yml:21-22` (`user_id` style). |
| Segment `sql:` (P2 segment emitter, via `flattenToSql`) | `{member}` same-cube, `{cube.member}` cross-cube | Segments reference existing dim/measure members; `flattenToSql` already enforces this. Member-ref survives column renames. |
| Measure `filters[].sql` (P2 measure emitter — unchanged) | `{CUBE}.<raw_column>` | Existing behavior in `generate-measure-yaml.ts:48-57` (`filterToSql`). |
| Measure `sql:` referencing other measures (P2 measure emitter — unchanged) | `{member_name}` | Existing behavior in `buildSqlRef`. |

This split matches what `mf_users.yml` actually contains (e.g. `case.when[].sql: '{CUBE}.ingame_total_recharge_value_vnd >= 10000000'` at line 153). Tests below pin the right form per kind.

Cube YAML shapes per dim kind:

```yaml
# banding
- name: payer_tier
  type: string
  case:
    when:
      - sql: "{CUBE}.ltv_vnd >= 10000000"
        label: whale
      - sql: "{CUBE}.ltv_vnd >= 1000000"
        label: dolphin
    else:
      label: non_payer
  meta: { … }

# time-since
- name: days_since_install
  sql: DATE_DIFF('day', {CUBE}.install_date, CURRENT_DATE)
  type: number
  meta: { … }

# passthrough
- name: country
  sql: unified_first_country_code
  type: string
  meta: { … }

# boolean
- name: is_paying_user
  sql: "CASE WHEN {CUBE}.ltv_vnd > 0 THEN TRUE ELSE FALSE END"
  type: boolean
  meta: { … }
```

Cube segment shape:

```yaml
- name: vn_whales
  sql: "{CUBE}.country = 'VN' AND {CUBE}.ltv_vnd >= 10000000"
  description: VN users with lifetime recharge >= 10M VND
  meta: { … }
```

## Related Code Files

- Create: `src/QueryBuilderV2/NewMetric/yaml/generate-cube-entry.ts`
- Create: `src/QueryBuilderV2/NewMetric/yaml/generate-dimension.ts`
- Create: `src/QueryBuilderV2/NewMetric/yaml/generate-segment.ts`
- Modify: `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` → rename to `generate-measure.ts`, keep exports; thin re-export shim in old file for transitional callers if any external imports exist. Otherwise delete.
- Create: `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-dimension.test.ts`
- Create: `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-segment.test.ts`
- Create: `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-cube-entry.test.ts`
- Read for context: `mf_users.yml` (canonical examples), `filter-tree/flatten-to-sql.ts`.

## Implementation Steps (TDD — tests first)

1. **Write failing tests for `generate-dimension` (template forms per red-team F-2):**
   - banding: 3 bands + else → emits `case: { when: [{sql, label}, ...], else: { label } }` with `when[].sql` using `{CUBE}.<raw_col>` form (NOT `{member}`). Outer key order `name, type, case, [title], [description], meta`.
   - time-since day unit + `install_date` → `sql: "DATE_DIFF('day', {CUBE}.install_date, CURRENT_DATE)", type: number` (also `{CUBE}.<raw>` form).
   - passthrough: column + type → `sql: <col>, type: <type>` (bare column, no template).
   - boolean: predicate `{CUBE}.ltv_vnd > 0` → wrapped as `sql: "CASE WHEN {CUBE}.ltv_vnd > 0 THEN TRUE ELSE FALSE END", type: boolean`.
   - Round-trip: parse YAML, dump again, reparse — semantic equality.
   - `sectionKey === 'dimensions'`.
2. **Write failing tests for `generate-segment` (template form per red-team F-2):**
   - Filter tree with one AND group + one leaf `country = VN` → `sql: "{country} = 'VN'"` (same-cube `{member}` form via `flattenToSql`, NOT `{CUBE}.country`).
   - Two-leaf AND with cross-cube ref → `sql: "({country} = 'VN') AND ({other_cube.foo} = 'x')"` (cross-cube member form).
   - Filter tree empty → throw with clear error (segment SQL cannot be empty).
   - Description from draft surfaces in YAML.
   - `sectionKey === 'segments'`.
   - SQL string escapes single quotes per existing `flatten-to-sql` rules (regression on string-quoting).
   - **Cross-cube defensive check (red-team F-9):** if any leaf references a cube other than `sourceCube`, generator throws "segment v1 is single-cube — leaf X references cube Y". Test covers it.
3. **Write failing tests for `generate-cube-entry` dispatcher:**
   - `artifactKind === 'measure'` → identical output to existing `generateV2` (regression gate — diff at byte level if possible).
   - `artifactKind === 'dimension'` → delegates to `generate-dimension`.
   - `artifactKind === 'segment'` → delegates to `generate-segment`.
   - Unknown kind → throw `Unsupported artifactKind: ...`.
4. **Implement `generate-dimension.ts`** following the test signatures above. Reuse `inferConvention` + `adaptName` from existing module.
5. **Implement `generate-segment.ts`** wrapping `flattenToSql`. Reject empty trees explicitly.
6. **Rename / factor `generate-measure-yaml.ts` → `generate-measure.ts`.** Keep `generate` and `generateV2` exports for back-compat (callers in P3/P4 to migrate).
7. **Implement `generate-cube-entry.ts`** dispatcher. One switch on `artifactKind`.
8. **Re-run** entire `yaml/__tests__/` suite — existing tests + new ones all green.

## Success Criteria

- [ ] All 3 generators round-trip safe (parse(emit) == parse(emit(parse(emit)))).
- [ ] Dispatcher correctly routes by `artifactKind`.
- [ ] All 4 dimension sub-kinds produce valid Cube YAML matching `mf_users.yml` examples byte-for-byte (modulo `meta:` block).
- [ ] Segment SQL uses `{CUBE}.<col>` form when cube reference matches the source cube (existing `buildSqlRef` semantics).
- [ ] Empty filter tree on segment → throws with explanatory message.
- [ ] Existing measure-mode YAML tests unchanged + green.
- [ ] No frontend UI changes (P2 is pure module work).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `case:` YAML key order differs from existing convention in `mf_users.yml` | Lock key order in test (`name, type, case, [title], [description], filters?, meta`). Use `[key, value]` tuple list pattern from existing `generate-measure-yaml.ts:176`. |
| `js-yaml` quotes the inner `sql:` strings inconsistently (single vs double) | Pre-existing limitation — accept it. Tests assert semantic equality after re-parse, not byte equality of quotes. |
| Boolean predicate SQL gets double-wrapped if user types `CASE WHEN ...` themselves | v1 contract: user supplies the **inner** condition only (e.g. `{CUBE}.ltv_vnd > 0`). UI label "When …" makes this explicit. Validate at the builder layer in P5. |
| `flattenToSql` emits SQL referencing cubes outside the primary | v1 segment scope is single-cube. P5 builder restricts column dropdown to source cube; emitter trusts that constraint. Add a defensive check that throws if a leaf references a non-source cube. |

## TDD Test Inventory

| Test | What it locks in |
|---|---|
| `generate-dimension banding emits case block` | Banding YAML shape |
| `generate-dimension time-since emits DATE_DIFF` | Time-since SQL format |
| `generate-dimension passthrough emits sql+type only` | Passthrough simplicity |
| `generate-dimension boolean wraps in CASE WHEN ... TRUE` | Boolean shape parity with `is_paying_user` |
| `generate-segment emits sql from filter tree` | Segment SQL flatten reuse |
| `generate-segment rejects empty tree` | Empty-tree guard |
| `generate-cube-entry dispatches by kind` | Dispatcher correctness |
| `measure-mode output unchanged from V2` | Regression gate |
