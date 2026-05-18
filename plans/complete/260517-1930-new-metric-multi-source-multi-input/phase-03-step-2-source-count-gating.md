---
phase: 3
title: "Step 2 source-count gating"
status: completed
priority: P1
effort: "0.5d"
dependencies: [1, 2]
---

# Phase 3: Step 2 source-count gating

## Overview

Make Step 2's `OperationBody` show ops where `op.minSources > draft.sourceCubes.length` as visibly disabled, with a hint that links back to Step 1. Eligibility count on the card uses the slot-aware logic (Phase 4), but the source-count gate trumps it: disabled-by-source takes priority over disabled-by-eligibility messaging.

## Requirements

- An op card with `op.minSources > sourceCubes.length` renders with:
  - greyed-out container (background + opacity drop, border de-emphasized)
  - locked badge or `Lock` icon adjacent to the op name
  - "Needs N sources" hint replacing the "X eligible" footer
  - `aria-disabled="true"`, `cursor: not-allowed`
- Clicking a source-gated card runs `back()` (return to Step 1) and triggers a one-shot highlight on the source body so the user notices where they need to act.
- All other ops remain selectable.
- Selecting an op then later reducing `sourceCubes.length` below `op.minSources` invalidates the selection: the wizard auto-resets `draft.operation` to the first op that still satisfies the gate, and emits a draft-validation error visible on the right rail.

## Architecture

### OperationBody gate

```ts
function isSourceGated(def: OperationDef, sourceCount: number): boolean {
  return def.minSources > sourceCount;
}
```

`OperationCard` receives a new prop `gated: { reason: 'source-count', need: number } | null` and renders the disabled variant when set. `useEligibleColumns` is still computed for the eligible-count footer, but the rendered footer text is `Needs ${need} sources — go back` when gated.

### Click behavior

```tsx
<Card
  $disabled={!!gated}
  onClick={() => {
    if (gated) {
      onRequestBack?.(); // wizard handler → back() + transient highlight
      return;
    }
    onSelect(def.id);
  }}
  aria-disabled={!!gated || undefined}
  title={gated ? `Pick at least ${gated.need} sources first.` : def.description}
>
```

The `onRequestBack` prop is plumbed from `OperationBody` → `NewMetricPage`, which calls `back()` and sets a transient flag (`highlightSourceCount: true`) read by `SourceBody` to pulse the source toolbar for ~1.5s.

### Auto-invalidate on source reduction

In `useNewMetricDraft`, when `sourceCubes` changes, run:

```ts
if (currentOp.minSources > nextDraft.sourceCubes.length) {
  nextDraft.operation = firstAllowedOp(nextDraft.sourceCubes.length).id; // 'sum'
  nextDraft.inputs = {}; // clear; Step 3 re-prompts
}
```

This avoids the wizard sitting in an invalid state when the user deselects their second source after picking Ratio.

### Visual disabled styling

`operation-body.tsx` styled-components addition:

```ts
const Card = styled.button<{ $selected: boolean; $disabled: boolean }>`
  /* existing */
  opacity: ${(p) => (p.$disabled ? 0.55 : 1)};
  background: ${(p) =>
    p.$disabled ? 'var(--bg-muted)'
    : p.$selected ? 'var(--brand-soft)'
    : 'var(--bg-card)'};
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  &:hover { border-color: ${(p) => (p.$disabled ? 'var(--border-card)' : 'var(--brand)')}; }
`;
```

### Right rail copy

`operation-detail-rail.tsx` for a source-gated op (if user has it focused for any reason): explain the gate in one sentence and link to Step 1.

## Related Code Files

- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-2-operation/operation-body.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-2-operation/operation-detail-rail.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-1-source/source-body.tsx` (transient highlight surface)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` (back-and-highlight handler; pass sourceCount; auto-invalidate hook)
- Modify: `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` (auto-reset operation on source shrink)

## Implementation Steps

1. Plumb `sourceCount` into `OperationBody`. Compute `gated` per card. Render disabled state.
2. Add lock icon (`Lock` from `lucide-react`) to the disabled card head. Replace eligible-count footer with the "Needs N sources — go back" hint when gated.
3. Wire `onRequestBack` from `OperationBody` → `NewMetricPage` (calls `back()` + `setHighlightSourceCount(true)` for ~1500 ms).
4. In `SourceBody`, accept a `highlight: boolean` prop and apply a brief CSS pulse (e.g. `box-shadow` keyframe) to the toolbar.
5. In `useNewMetricDraft`, watch `sourceCubes.length`: if the active op's `minSources` exceeds it, reset to the lowest-id allowed op and clear `inputs`. Surface a one-time toast/notice via the validation card explaining the reset.
6. Update `operation-detail-rail.tsx` to show the source-gate explanation when applicable (only relevant if the user navigates back to Step 2 after the reset — defensive copy).
7. Snapshot test for `operation-body.tsx` rendering with `sourceCount=1` (Ratio disabled) vs `sourceCount=2` (Ratio enabled).
8. Unit test for `useNewMetricDraft` auto-reset behavior.

## Success Criteria

- [ ] With 1 source picked, Ratio's card is visibly disabled (greyed background, lock icon, "Needs 2 sources — go back" footer, `aria-disabled`).
- [ ] With 2+ sources picked, Ratio's card is fully interactive.
- [ ] Clicking the disabled Ratio card sends the user back to Step 1 with a brief highlight on the source list.
- [ ] Selecting Ratio with 2 sources then deselecting one auto-resets `draft.operation` to a single-source op and clears `inputs`; user is notified.
- [ ] Snapshot tests cover both gated and ungated states.

## Risk Assessment

- **Click-disabled inconsistency.** Browsers vary on whether `pointer-events: none` plays with `onClick`. Mitigation: don't use `pointer-events: none`; let the click handler short-circuit so the back-navigation still fires.
- **Auto-reset surprises the user.** Someone deselects a source by accident and loses their Ratio inputs. Mitigation: show the reset notice in the validation card with an undo affordance (re-add the dropped cube name). Out of scope to implement undo in this plan; the notice alone is sufficient for v1.
- **Source highlight pulse styling leaks.** A keyframe on the toolbar could cause layout jank if mounted under flex. Mitigation: pulse via `box-shadow` only, no size change.

## Security Considerations

None.

## Next Steps

Phase 4 renders the N-slot inputs in Step 3.
