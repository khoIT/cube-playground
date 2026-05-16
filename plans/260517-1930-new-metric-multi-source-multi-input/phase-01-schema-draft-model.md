---
phase: 1
title: "Schema & draft model"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Schema & draft model

## Overview

Migrate the wizard model from `(sourceCube, ofMember, ofMemberB)` to `(sourceCubes[], inputs)` and replace `OperationDef.accepts` with `OperationDef.inputs: InputSlot[]` + `OperationDef.minSources`. Update the validator, YAML emitter, and the dialog-flow compat shim. No UI yet — this phase keeps the existing screens green via the shim while the underlying contract changes.

## Requirements

- `NewMetricDraft.sourceCubes: string[]` replaces `sourceCube`. `sourceCubes[0]` is primary.
- `NewMetricDraft.inputs: Record<string, string | null>` replaces `ofMember`/`ofMemberB`. Keys = slot ids (e.g. `value`, `numerator`, `denominator`).
- `OperationDef.inputs: InputSlot[]` and `OperationDef.minSources: number` added; `OperationDef.accepts` removed.
- `validateDraft` errors keyed by `inputs.<slotId>` for slot-level violations; removes the same-cube prefix check.
- YAML emitter reads `inputs` and `sourceCubes[0]` — output bytes unchanged for the single-source/single-slot legacy case.
- Dialog flow (`OfSection`, `SourceSection`, etc.) keeps working via getter/setter shims that map `ofMember` ↔ `inputs[<primarySlotId>]` and `sourceCube` ↔ `sourceCubes[0]`.

## Architecture

### InputSlot shape

```ts
// src/QueryBuilderV2/NewMetric/full-page/steps/step-2-operation/operations.ts
export type SlotAccepts = 'numeric' | 'all' | 'all-dimensions';

export type InputSlot = {
  id: string;            // 'value' | 'numerator' | 'denominator' | ...
  label: string;         // 'Column' | 'Numerator' | 'Denominator'
  accepts: SlotAccepts;
  required: boolean;
};

export type OperationDef = {
  id: Operation;
  name: string;
  formula: string;
  description: string;
  minSources: number;     // 1 for every op except ratio (2)
  inputs: InputSlot[];    // [] for count, [{id:'value',...}] for scalar, 2 slots for ratio
  example: string;
  pro?: boolean;
  dontUseFor?: string;
};
```

### Draft shape

```ts
// src/QueryBuilderV2/NewMetric/types.ts
export interface NewMetricDraft {
  sourceCubes: string[];                    // [] until user picks
  operation: Operation;
  inputs: Record<string, string | null>;    // slotId → reachable-member name
  // ... rest unchanged: filters, identity, grain, etc.
}
```

### Compat shim (legacy dialog flow)

```ts
// inside useNewMetricDraft
const sourceCube = draft.sourceCubes[0] ?? null;
const ofMember = draft.inputs[primarySlotIdFor(draft.operation)] ?? null;
const ofMemberB = draft.operation === 'ratio' ? draft.inputs.denominator ?? null : null;
```

`primarySlotIdFor` returns `'value'` for scalar ops and `'numerator'` for ratio. Legacy `setField('ofMember', x)` calls are rewritten to `setInput('numerator' | 'value', x)` at the section level (see Phase 5 for legacy retire — out of scope here, but the shim must keep the dialog working).

## Related Code Files

**Schema + emitter core:**
- Modify: `src/QueryBuilderV2/NewMetric/types.ts` (`NewMetricDraft` shape)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-2-operation/operations.ts` (drop `OperationAccepts`, add `InputSlot` + `minSources`)
- Modify: `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` (`INITIAL_DRAFT`, `validate` fn — note: exported as `validate`, not `validateDraft`; localStorage hydrate at lines 214-305 needs old→new shape migration)
- Modify: `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` (read `sourceCubes[0]` + `inputs`)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/hooks/use-eligible-columns.ts` (rename `OperationAccepts` → `SlotAccepts`)

**Behavioral surfaces that read `draft.sourceCube` / `draft.ofMember` (verified by grep — must all migrate in this phase):**
- Modify: `src/QueryBuilderV2/NewMetric/full-page/hooks/compute-auto-metric-name.ts` (5 read sites; ratio name template stays `ratio_{primary}` per validation decision — use `sourceCubes[0]`)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/hooks/use-active-step.ts` (lines 33, 52 — navigation gate uses `sourceCubes.length >= 1`)
- Modify: `src/QueryBuilderV2/NewMetric/hooks/use-metric-yaml.ts` (lines 29, 44 — pass `sourceCubes[0]` to emitter; gate on `inputs[primarySlotId]` instead of `ofMember`)
- Modify: `src/QueryBuilderV2/NewMetric/hooks/use-dry-run-sql.ts` (line 57 — `useReachableMembers(sourceCubes)` signature update)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/yaml-preview-rail.tsx` (lines 83, 86 — primary cube only)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-body.tsx` (lines 84-203 — `cubeName: sourceCubes[0]`; cross-cube ratio test SQL flows through the new YAML emitter so no further query changes needed at this site)

**Legacy dialog flow (compat shim path — keeps working via derived getters):**
- Modify: `src/QueryBuilderV2/NewMetric/sections/of-section.tsx` (read derived `ofMember`/`ofMemberB` via shim; write through `setInput`)
- Modify: `src/QueryBuilderV2/NewMetric/sections/source-section.tsx` (write `sourceCubes: [name]` via shim)
- Modify: `src/QueryBuilderV2/NewMetric/sections/filter-section.tsx` (read `sourceCubes[0]`)
- Modify: `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx` (3 sites — `cubeName: sourceCubes[0]`)
- Modify: `src/QueryBuilderV2/NewMetric/steps/step-define.tsx` (`useFindSimilar(sourceCubes[0], ...)`)
- Modify: `src/QueryBuilderV2/NewMetric/steps/step-preview.tsx` (lines 57-73 — primary cube lookup + `cubeName`)

**Tests:**
- Modify: `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-new-metric-draft.test.ts` (line 116 reversed: "allows cross-cube ratio when both cubes are selected"; new shape tests)
- Modify: `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-new-metric-draft-v2.test.ts` (lines 55, 104 expect `sourceCubes[0]`)
- Modify: `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-measure-yaml.test.ts` (snapshots unchanged for legacy shape)
- Modify: `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-measure-yaml-v2.test.ts`

## Implementation Steps

1. **Add the `InputSlot` + `OperationDef` rewrite.** Drop `OperationAccepts` from `operations.ts`. Define `inputs` and `minSources` for all 9 ops. Sum/Avg/Min/Max/Median/Percentile = one numeric slot. Count/CountDistinct = one `all` slot (the optional count-rows path keeps working via `required: false`). Ratio = two numeric slots `numerator` + `denominator`, `minSources: 2`.
2. **Migrate `NewMetricDraft`.** Rename `sourceCube` → `sourceCubes`, replace `ofMember`/`ofMemberB` with `inputs`. Update `INITIAL_DRAFT` (`use-new-metric-draft.ts:14-17`).
3. **Add `setInput(slotId, value)` to `useNewMetricDraft`.** Returns the same `setField` ergonomics for the inputs map. Keep `setField` for non-input fields.
4. **Rewrite `validate`** (the exported function; not `validateDraft`). Drop the same-cube prefix check (lines 90-97). For each required slot of the active op, error keyed `inputs.<slotId>`. Source error becomes `sourceCubes: 'At least one source cube is required.'` and `'At least 2 sources required for {opName}.'` when `sourceCubes.length < op.minSources`. <!-- Updated: Validation Session 1 - corrected fn name from validateDraft → validate, matches export at use-new-metric-draft.ts:62 -->
5. **Extend reachable-name validation.** Pass `sourceCubes` (not single cube) into `useReachableMembers` — see Phase 4 for the hook change. Phase 1 only widens the function signature and reads the union, leaving behavior the same for `sourceCubes.length === 1`.
6. **Rewrite YAML emitter.** `generate-measure-yaml.ts` reads `draft.inputs.numerator` / `denominator` / `value` and `draft.sourceCubes[0]`. Snapshot tests stay green because the legacy single-source case produces identical bytes.
7. **Compat shim for dialog sections.** Add derived `sourceCube` / `ofMember` / `ofMemberB` to the `useNewMetricDraft` return so `OfSection` and `SourceSection` keep compiling. Setters in those sections are rewritten to `setInput`/`setField('sourceCubes', [name])`.
8. **Update / extend tests.** Replace the "errors on ofMemberB when denominator belongs to a different cube" test (line 116) with "allows cross-cube ratio when both cubes are selected". Add tests for: empty `sourceCubes`, ratio with `sourceCubes.length === 1` (error), valid 2-cube ratio, missing required slot, optional `value` slot for count.
9. **Compile + run unit suites.** `pnpm -s tsc --noEmit` and the NewMetric test files must pass before Phase 2 starts.

## Success Criteria

- [ ] `NewMetricDraft` has `sourceCubes: string[]` and `inputs: Record<string, string | null>`; old fields removed (or kept only as derived getters in the shim).
- [ ] `OperationDef` has `inputs: InputSlot[]` + `minSources`; `accepts` removed.
- [ ] All 9 ops have correct `inputs` and `minSources` (8 with `minSources: 1`, ratio with `minSources: 2`).
- [ ] `validateDraft` errors on `sourceCubes.length === 0`, on `< minSources`, and on missing required slots.
- [ ] `validateDraft` no longer errors on cross-cube ratio.
- [ ] YAML emitter produces byte-identical output for legacy single-source single-input drafts (snapshot tests green).
- [ ] Dialog flow (legacy `NewMetricDialog`) still mounts and works via the shim.
- [ ] `pnpm -s tsc --noEmit` clean; NewMetric unit tests green.

## Risk Assessment

- **YAML drift for new ratio shape.** Cross-cube ratio emits `{cube_a}.measure_a / NULLIF({cube_b}.measure_b, 0)` — verify Cube schema accepts this template (`buildSqlRef` already supports it for non-ratio measures). Mitigation: add a YAML snapshot test for cross-cube ratio before flipping the validator.
- **Compat shim leakage.** If a legacy caller writes `ofMember` directly via `setField`, the new model won't see it. Mitigation: type-narrow `setField`'s `K` so `'ofMember'` / `'ofMemberB'` / `'sourceCube'` are no longer assignable; convert all call sites in this phase.
- **Default operation = sum but `INITIAL_DRAFT.sourceCubes = []`.** Step 2 must show all ops disabled until at least one source is picked, otherwise the user can pick a min-2 op with zero sources. Phase 3 covers the UI gate; Phase 1 just ensures validator catches the state.

## Security Considerations

None — purely client-side schema migration. No new SQL surface.

## Next Steps

Phase 2 implements the multi-select source UI. Phase 1's contract must be solid before then.
