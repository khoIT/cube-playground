---
phase: 4
title: "Step 3 N-slot inputs"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1, 2, 3]
---

# Phase 4: Step 3 N-slot inputs

## Overview

Replace the single-column picker in `step-3-column/column-body.tsx` with an N-slot inputs renderer driven by `OperationDef.inputs`. Each slot gets its own eligibility grid populated from the union of selected cubes' reachable members. The legacy single-slot ops (Sum, Avg, …) render exactly one grid, so the visual is unchanged on the happy path; Ratio renders two side-by-side grids.

Also widens `useReachableMembers` and `useEligibleColumns` to accept a list of source cubes.

## Requirements

- Step 3 reads `op.inputs[]` and renders one labeled section per slot.
- Each slot's eligibility filter respects `slot.accepts` (numeric / all / all-dimensions).
- Cross-cube reachability honored: a measure from cube B is selectable as long as cube B is in `sourceCubes` and joinable to the primary (or to another already-selected cube — see Architecture for the rule).
- Selecting a member for slot `numerator` does NOT exclude it from slot `denominator` (you can divide a measure by itself if you really want); but render a soft warning when both slots resolve to the same member.
- Step 3 "Continue" enables only when every `required` slot is filled.
- Right rail (`column-health-rail.tsx`) shows stats for the currently focused slot, with a small slot switcher when there are 2+ slots.

## Architecture

### `useReachableMembers(sources: string[])`

Today: takes a single source cube via context; builds a join graph; returns members reachable from that one cube.

After: takes the full `sourceCubes` array. Returns the union of members reachable from any selected cube via the existing join graph. A member is reachable iff its cube is in `sourceCubes` OR is joined to some cube in `sourceCubes`.

Each returned `ReachableMember` keeps `cubeName` so the renderer can group by cube within each slot.

### Slot UI

```
┌──────────────────────────┐  ┌──────────────────────────┐
│ Numerator                │  │ Denominator              │
│ (4 numeric eligible)     │  │ (4 numeric eligible)     │
│ ┌────────┐ ┌────────┐    │  │ ┌────────┐ ┌────────┐    │
│ │ measure│ │ measure│ …  │  │ │ measure│ │ measure│ …  │
│ └────────┘ └────────┘    │  │ └────────┘ └────────┘    │
└──────────────────────────┘  └──────────────────────────┘
```

For ≤2 slots: side-by-side. For 3+ slots: stacked vertically with collapsible sections (out of scope today; the only multi-slot op is Ratio with 2).

Each card shows the member's qualified name `cube.member` (helpful with multi-source). Members grouped by cube with a small cube-name divider when `sourceCubes.length > 1`.

### `useEligibleColumns(cubes: WizardCube[], accepts: SlotAccepts)`

Generalized to a list of cubes. Walks dims/measures from each cube, applies the `accepts` filter, returns `EligibleColumn[]` with cube-qualified names. The single-cube call site (Step 4 filter dropdown) passes a one-element array.

Reject reasons get a `cube` field so the "Why only N?" popup can break down rejects by source cube when there are several.

### Step 3 body shape

```tsx
function InputsBody({ cubes, primaryCube, operation, inputs, onSelect }: Props) {
  const op = findOp(operation);
  if (!op || op.inputs.length === 0) return <CountOnlyHint />;
  return (
    <SlotGrid $cols={op.inputs.length}>
      {op.inputs.map((slot) => (
        <SlotPicker
          key={slot.id}
          slot={slot}
          cubes={cubes}
          selected={inputs[slot.id] ?? null}
          onSelect={(memberName) => onSelect(slot.id, memberName)}
        />
      ))}
    </SlotGrid>
  );
}
```

`onSelect(slotId, memberName)` flows back to `setInput(slotId, memberName)` (added in Phase 1).

### Right rail per slot

`column-health-rail.tsx` gains a slot prop:

- Single-slot ops: behaves as today (reads `inputs.value` or whatever the primary slot id is).
- Multi-slot ops: shows a slot tab strip across the top (`Numerator | Denominator`); the active tab's member's stats are rendered. Active slot = last one the user clicked.

### Same-member warning

If `op.id === 'ratio' && inputs.numerator && inputs.numerator === inputs.denominator`, render an inline `<Hint type="warning">` below the slot grid: "Numerator and denominator are the same — your ratio will always be 1."

### Ratio cross-cube emission sanity

YAML emitter (already widened in Phase 1) emits `{cubeA}.measure / NULLIF({cubeB}.measure, 0)`. Add a snapshot test in this phase that exercises a cross-cube ratio end-to-end so we lock the output.

## Related Code Files

- Rewrite: `src/QueryBuilderV2/NewMetric/full-page/steps/step-3-column/column-body.tsx` (renamed semantically to "inputs body"; file path stays for diff hygiene)
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-3-column/slot-picker.tsx` (one slot's eligibility grid)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-3-column/column-health-rail.tsx` (slot switcher; accept active slot id)
- Modify: `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts` (signature: `(sourceCube: string | null)` → `(sourceCubes: string[])`)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/hooks/use-eligible-columns.ts` (signature: `(cube, accepts)` → `(cubes: WizardCube[], accepts)`)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` (Step 3 props; `selectedCubes` instead of `selectedCube`; line 348 `canContinue` fixed to gate on every required slot — pre-existing bug noted: today only gates on `ofMember`, allowing ratio through with no denominator)

**All `useEligibleColumns` callers (verified by grep — must all migrate when signature widens):**
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-2-operation/operation-body.tsx:117` (`useEligibleColumns(cube, def.accepts)` → reads first slot's `accepts` for the eligible-count footer; pass `selectedCubes`)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-2-operation/operation-detail-rail.tsx:63` (same migration)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-3-column/column-body.tsx:92` (rewritten by this phase — single call replaced with N slot pickers)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-4-filters/filters-body.tsx:186` (`useEligibleColumns(cube, 'all-dimensions')` → `useEligibleColumns([primaryCube], 'all-dimensions')`)

**All `useReachableMembers` callers (verified by grep):**
- Modify: `src/QueryBuilderV2/NewMetric/hooks/use-dry-run-sql.ts:57` (`useReachableMembers(args.sourceCube)` → pass `args.sourceCubes`; `args` shape updated by Phase 1)
- Modify: `src/QueryBuilderV2/NewMetric/sections/of-section.tsx:51` (legacy dialog — passes `[draft.sourceCubes[0]]` via shim; same behavior as today)
- Modify: `src/QueryBuilderV2/NewMetric/sections/source-section.tsx:19` (same shim path)
- Modify: `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-reachable-members.test.ts`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-2-operation/__tests__/operations.test.ts` (slot definitions)
- Create: `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-measure-yaml-cross-cube-ratio.test.ts`

## Implementation Steps

1. Generalize `useReachableMembers` to accept `sources: string[]`. Internally, union per-cube reachability over the existing join graph. Update its existing test plus add a 2-cube case.
2. Generalize `useEligibleColumns` to accept `WizardCube[]`. Update Step 4 filter dropdown caller to pass `[primaryCube]`. Reject-reason struct gains `cube` for the "why" popup.
3. Build `SlotPicker`: header row (`slot.label`, `${eligible.length} ${slot.accepts}`), grid of cards grouped by cube when `>1` cube. Selection state via `selected === c.name` (same as today).
4. Rewrite `column-body.tsx` to render N slots. Side-by-side via CSS grid when N ≤ 2; stacked otherwise.
5. Wire `onSelect(slotId, memberName)` → `setInput(slotId, memberName)`.
6. Update `column-health-rail.tsx` with the slot tab strip + active-slot state. Default active slot = first slot.
7. Update Step 3 footer gate in `NewMetricPage.tsx`: `canContinue = op.inputs.every(s => !s.required || !!draft.inputs[s.id])`.
8. Add the "numerator === denominator" inline warning component.
9. Add cross-cube YAML snapshot test. Verify the output uses `{cubeA}.{shortName}` / `{cubeB}.{shortName}` and `NULLIF`.
10. Compile + run all NewMetric unit tests. Manually click through: 1 cube + Sum, 1 cube + Ratio (gated), 2 cube + Ratio cross-cube.

## Success Criteria

- [ ] Sum (and every single-slot op) renders one eligibility grid — same visual as today.
- [ ] Ratio with `sourceCubes.length === 2` renders two grids side-by-side, populated from the union of both cubes' numeric measures.
- [ ] Each card shows the qualified `cube.member` name; rows grouped under a cube divider when there are 2+ sources.
- [ ] Selecting a member for `numerator` doesn't clear `denominator` and vice versa.
- [ ] "Continue" is disabled until every required slot is filled.
- [ ] Right-rail health switches between slots when there are 2; works unchanged for single-slot ops.
- [ ] Cross-cube ratio emits valid YAML with two `{cube}.shortName` refs and `NULLIF`. Snapshot test green.
- [ ] Same-member warning surfaces when both ratio slots resolve to the same member.
- [ ] `useReachableMembers` and `useEligibleColumns` callers across both wizard flows compile.

## Risk Assessment

- **Join-graph gaps.** A second selected cube with no join path to anything in `sourceCubes` would yield zero contributable measures. Mitigation: Step 1 allows the selection (no implicit gate); Step 3 surfaces the cube as "0 eligible — not joined to {primary}" so the user understands. Out of scope to forcibly remove the cube.
- **Right-rail flicker on slot switch.** Switching slots triggers a fresh `useColumnStats` query if the member differs. Mitigation: cache per-member stats (already memoized by member name today).
- **Folder rename churn.** Renaming `step-3-column/` → `step-3-inputs/` would move every import path. Mitigation: KEEP the folder named `step-3-column` in this plan; rename later if the name becomes misleading.

## Security Considerations

Cross-cube ratio emits SQL that references two cubes — verify Cube YAML supports `{cubeA}.x / NULLIF({cubeB}.y, 0)` syntactically. The validator's reachable-name check already prevents references to cubes the user hasn't selected.

## Next Steps

Phase 5 covers test coverage gaps, docs, and the in-app walkthrough copy.
