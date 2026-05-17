---
phase: 5
title: "Dimension UI kind picker and four builders"
status: completed
priority: P1
effort: "2d"
dependencies: [4]
---

# Phase 5: Dimension UI kind picker and four builders

## Overview

Build the dimension-mode UI: a Dim-kind picker screen + four builder bodies (banding, time-since, passthrough, boolean) that feed `draft.dimBuilder` and produce valid YAML via P2's `generate-dimension.ts`. Identity step shared with measure mode. Test-run step wired in P7.

**Red-team applied:** F-5 (boolean predicate generator-enforced sanitization), F-13 (effort 1.5d → 2d for realistic budget).

## Requirements

- **Functional:**
  - **Dim-kind picker:** 4 cards with one-line description + canonical example from `mf_users.yml`.
  - **Banding builder:** column dropdown (numeric or string, scoped to source cube) + dynamic N-row band list (`condition SQL` + `label`) + required else label. Add/remove band rows. Validates each row before allowing Continue.
  - **Time-since builder:** column dropdown (time-typed columns only) + unit selector (`day` / `hour` / `month`). Output type fixed to `number`.
  - **Passthrough builder:** column dropdown (all columns of source cube) + output-type selector (`string` / `number` / `boolean` / `time`) defaulted from the source column's Cube type.
  - **Boolean builder:** predicate input — **MUST be a single-leaf `FilterLeafRow` shape (operator + typed value)**, NOT free-text SQL. The shape is enforced both at UI layer AND at generator layer (`generate-dimension.ts` for `boolean` kind rejects raw SQL containing `;`, control bytes, unquoted scalars, or anything not produced by `flattenToSql`'s sanitizer). Red-team F-5 + brainstorm Risk 4. UI text "When this condition is TRUE …".
  - Builder body live-validates against `generate-dimension.ts` so user sees actionable errors before Continue.
  - YAML preview rail shows the dimension YAML block live as the user edits (reuses `yaml-preview-rail.tsx` with `sectionKey`-driven header).
- **Non-functional:**
  - Banding: visually compact — 1 row = `[SQL input] when [label input] [remove]`. Drag-to-reorder optional v1 polish, defer if time tight.
  - Each builder body ≤ 200 lines per the project's modularization rule.

## Architecture

```
full-page/steps/
├── step-dim-kind/
│   ├── dim-kind-body.tsx              (4 cards)
│   └── dim-kind-card.tsx              (single card)
└── step-dim-builder/
    ├── dim-builder-body.tsx           (dispatcher — picks sub-builder by dimKind)
    ├── banding-builder.tsx            (N-row band list)
    ├── banding-row.tsx                (single row)
    ├── time-since-builder.tsx
    ├── passthrough-builder.tsx
    └── boolean-builder.tsx
```

Banding row example UX:

```
[ {CUBE}.ltv_vnd >= 10000000 ] when [ whale ] [×]
[ {CUBE}.ltv_vnd >= 1000000  ] when [ dolphin ] [×]
[ {CUBE}.ltv_vnd > 0          ] when [ minnow ] [×]
                          else label: [ non_payer ]
[+ Add band]
```

## Related Code Files

- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-kind/dim-kind-body.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-kind/dim-kind-card.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-builder/dim-builder-body.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-builder/banding-builder.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-builder/banding-row.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-builder/time-since-builder.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-builder/passthrough-builder.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-dim-builder/boolean-builder.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — wire dim-kind + builder bodies.
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/yaml-preview-rail.tsx` — `sectionKey`-driven header.
- Create: `__tests__/banding-builder.test.tsx`, `time-since-builder.test.tsx`, `passthrough-builder.test.tsx`, `boolean-builder.test.tsx`.
- Read for context: `mf_users.yml` banding examples, `use-eligible-columns.ts` for column dropdowns.

## Implementation Steps (TDD — tests first)

1. **Write failing tests for each builder** (React Testing Library):
   - **Banding:** render with 0 bands → "Add band" CTA visible. Add 3 bands + fill SQL/label, set else → `onChange` fires with `dimBuilder: { kind:'banding', bands:[...], else:'...' }` matching expected shape. Empty band row blocks Continue (done-flag false).
   - **Time-since:** pick column + unit → `dimBuilder: { kind:'time-since', timeColumn, unit }` shape. Non-time column not selectable.
   - **Passthrough:** pick column + type → shape correct. Type defaults from source column's Cube type if available.
   - **Boolean:** type predicate → wraps in single-leaf builder shape. Empty predicate blocks Continue.
2. **Write failing test for `dim-builder-body` dispatcher** — given `dimKind`, renders the right sub-body. Switching `dimKind` clears prior sub-state via reducer (P1 contract).
3. **Write failing test for YAML preview rail** — for each dim kind, the rail renders correct YAML block matching `generate-dimension.ts` output (integration test).
4. **Implement `dim-kind-body.tsx`** + 4 cards with copy + click-to-select + Continue.
5. **Implement `passthrough-builder.tsx`** first (simplest). Verify YAML preview updates live.
6. **Implement `time-since-builder.tsx`.** Filter column dropdown to time-typed columns from `useEligibleColumns`.
7. **Implement `banding-builder.tsx`** + `banding-row.tsx`. N-row state managed locally; flatten to `dimBuilder.bands[]` via `onChange`.
8. **Implement `boolean-builder.tsx`.** Reuse `FilterLeafRow` from `step-4-filters/filter-leaf-row.tsx` to keep input UX consistent — its onChange shape adapts to a single SQL string.
9. **Wire YAML preview rail** to call `generateEntry(draft, ctx)` when in dim mode; render the `sectionKey: 'dimensions'` header.
10. **Manual end-to-end smoke** for each sub-kind:
    - Banding: create `payer_tier_v2` on `mf_users` → identity → test-run (P7 placeholder OK for now) → submit. YAML lands in `cube.dimensions[]`. Cube `/meta` reflects.
    - Time-since, passthrough, boolean: same flow, separate names.

## Success Criteria

- [ ] All 4 builder tests green.
- [ ] Dim-kind dispatcher routes correctly.
- [ ] YAML preview rail renders correct block per sub-kind.
- [ ] Banding builder rejects empty SQL/label rows and missing else.
- [ ] Time-since column dropdown shows only time-typed columns.
- [ ] Passthrough output-type defaults from source column.
- [ ] Boolean predicate wraps correctly into Cube YAML (`CASE WHEN ... THEN TRUE ELSE FALSE END`).
- [ ] Manual end-to-end: 4 new dims written to `mf_users.yml` via the wizard, visible in Cube `/meta`.
- [ ] Each builder body file ≤ 200 lines.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| User enters raw SQL with `{CUBE}.` references but column dropdown shows short names → mismatch | Banding/boolean show a "Use `{CUBE}.column_name` to reference this cube" hint inline. Column dropdown inserts the full template form on pick. |
| Banding else label silently NULL when user leaves blank | Validation rule blocks Continue when `else` empty. (Confirmed Open Question #1 at plan level.) |
| Time-since unit `month` not supported by Cube's `DATE_DIFF` on some warehouses | Cube doc says `day/hour/month/year/etc.` work. Add a fallback warning if `cubejsApi.sql()` later complains — covered by existing P7 test-run error handling. |
| Passthrough type-mismatch with column's underlying SQL type (e.g. user picks `boolean` for a `varchar` column) | Default type from source column metadata; allow override but show a yellow caution. Don't block — user may know what they're doing. |
| Boolean builder's predicate input is a free-text SQL field, risking injection at write time | **Closed (red-team F-5):** boolean predicate is now `FilterLeafRow`-shaped (UI) AND generator rejects raw SQL with `;`, control bytes, or unquoted values (`generate-dimension.ts`). `js-yaml.dump` does NOT prevent SQL injection at query time — the leaf-shape constraint does. |

## TDD Test Inventory

| Test | What it locks in |
|---|---|
| `banding-builder accepts N bands + else` | Banding shape |
| `banding-builder blocks Continue on empty row` | Validation gate |
| `time-since-builder filters to time columns` | Column eligibility |
| `passthrough-builder defaults output-type from source` | Smart default |
| `boolean-builder wraps predicate correctly` | Boolean YAML shape |
| `dim-builder-body dispatches by dimKind` | Dispatcher correctness |
| `yaml preview shows correct section header for dim` | Rail integration |
