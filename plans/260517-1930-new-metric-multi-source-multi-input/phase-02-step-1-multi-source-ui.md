---
phase: 2
title: "Step 1 multi-source UI"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Step 1 multi-source UI

## Overview

Convert `step-1-source/source-body.tsx` from single-cube selection to multi-cube selection. Card click toggles membership in `sourceCubes`. The first-selected cube gets a "Primary" badge (where the YAML measure will live). Sidebar / left-rail identity hero shows the cube count, with the primary cube as the headline.

## Requirements

- Multiple source cards can be selected at once.
- Visible distinction between primary cube (first in `sourceCubes`) and additional cubes.
- A clear "Continue" gate: requires `sourceCubes.length >= 1`.
- Source preview rail (right rail) shows the primary cube's preview by default; if no primary, shows the count + a hint to pick one.
- All cube cards stay clickable — there's no max selection cap in this plan.

## Architecture

### SourceBody props change

```ts
// before
export type SourceBodyProps = {
  cubes: WizardCube[];
  selectedName: string | null;
  onSelect: (cubeName: string) => void;
  cubeApi: CubeApi | null;
};

// after
export type SourceBodyProps = {
  cubes: WizardCube[];
  selectedNames: string[];                 // ordered; [0] is primary
  onToggle: (cubeName: string) => void;    // toggles membership
  onSetPrimary: (cubeName: string) => void;
  cubeApi: CubeApi | null;
};
```

### SourceCard rendering

- Card border state: `idle` | `selected` | `primary`. Primary = thicker brand border + "Primary" pill in the header.
- Clicking the card body toggles selection.
- Clicking the "Make primary" link on a non-primary selected card reorders `sourceCubes` so this cube becomes `[0]`.
- Reorder must keep the first-pick-wins default — only the explicit "Make primary" link demotes the existing primary.

### Wizard state plumbing

`NewMetricPage.tsx` derives `selectedCubes` as `meta.cubes.filter(c => draft.sourceCubes.includes(c.name))` and `primaryCube` as `draft.sourceCubes[0]`. Pass `selectedNames={draft.sourceCubes}`, `onToggle={toggleSource}`, `onSetPrimary={setPrimarySource}`. Implement both as helpers on `useNewMetricDraft`:

```ts
function toggleSource(name: string) {
  setField('sourceCubes', toggle(draft.sourceCubes, name));
}
function setPrimarySource(name: string) {
  setField('sourceCubes', [name, ...draft.sourceCubes.filter(n => n !== name)]);
}
```

### Identity rail / left rail

`left-rail.tsx`'s "selected source" hero shows:
- 1 cube: cube name (unchanged behavior).
- 2+ cubes: `{primary} + {n-1} more` with a tooltip listing the rest.

`right-rail.tsx` Step 1 slot keeps using `source-preview-rail.tsx` against `primaryCube`. When `primaryCube` is null but `sourceCubes` is non-empty (impossible by construction but defensive), show empty state.

### Footer gate

`canContinue` in `NewMetricPage.tsx:267` becomes `draft.sourceCubes.length >= 1` (was `!!draft.sourceCube`).

## Related Code Files

- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-1-source/source-body.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-1-source/source-card.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` (selectedCube → primaryCube + selectedCubes)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/shell/left-rail.tsx` (identity hero summary)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-1-source/source-preview-rail.tsx` (accept primary cube; no behavior change otherwise)
- Modify: `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` (add `toggleSource` + `setPrimarySource`)

## Implementation Steps

1. Rewrite `SourceBody` props and the click handler. Selection is now a `Set<string>` derived from `selectedNames` for O(1) lookup.
2. Update `SourceCard` to render three visual states (idle / selected / primary). Add the "Primary" pill and the "Make primary" link (visible only on selected non-primary cards). Add `aria-pressed` semantics.
3. Add `toggleSource` and `setPrimarySource` to `useNewMetricDraft`.
4. Update `NewMetricPage.tsx`:
   - Derive `primaryCube = meta.cubes.find(c => c.name === draft.sourceCubes[0]) ?? null`.
   - Derive `selectedCubes: WizardCube[]` for any consumer that needs the union (Step 3 in Phase 4).
   - Pass `selectedNames` + `onToggle` + `onSetPrimary` to `SourceBody`.
   - Replace `canContinue={!!draft.sourceCube}` with `canContinue={draft.sourceCubes.length >= 1}`.
   - Wire `primaryCube` into right-rail/identity props that previously used `selectedCube`.
5. Update `left-rail.tsx` hero copy: single-cube path unchanged; multi-cube path shows `{primary} +{n-1}`.
6. Validation card (`validation-card.tsx`) — check whether it reads `draft.sourceCube`; if yes, switch to `draft.sourceCubes.length >= 1`.
7. URL deep-link: `NewMetricPage.tsx:103` reads `cubeParam` and sets `sourceCube`. Replace with `setField('sourceCubes', [cubeParam])` when `sourceCubes` is empty.
8. localStorage shape may need a migration read-step — if persisted draft has `sourceCube`, map it to `sourceCubes: [sourceCube]` on hydrate; same for `ofMember` → `inputs`. Handled in `useNewMetricDraft`'s hydrate.

## Success Criteria

- [ ] Clicking 2+ source cards selects them all; clicking a selected card deselects it.
- [ ] First-selected cube renders with a "Primary" pill and brand-emphasized border.
- [ ] "Make primary" on a non-primary selected card promotes it; the previous primary stays selected as a non-primary peer.
- [ ] Step 1 "Continue" stays disabled with 0 sources, enables with ≥1.
- [ ] Right rail's source preview shows the primary cube; left rail hero summarizes the selection.
- [ ] Deep-link `?cube=foo` populates `sourceCubes: ['foo']`.
- [ ] Persisted drafts with the old `sourceCube` field hydrate correctly into `sourceCubes`.
- [ ] No regression on the single-cube happy path (1 cube selected → behaves exactly like today).

## Risk Assessment

- **Reorder UX confusion.** Users may not notice the "Make primary" affordance and end up with the wrong cube as primary. Mitigation: pill is bold + colored; tooltip on hover; first-pick-wins default keeps the most likely choice without action.
- **Right rail thrash.** If preview rail keys off `primaryCube.name`, toggling primary may refetch column stats. Mitigation: memoize on primary cube name; preview rail is read-only at Step 1, no fetch cost.
- **Localstorage drafts in the wild.** Any in-flight drafts persisted under the old schema must hydrate cleanly. Mitigation: hydrate step migrates shape; failures fall back to `INITIAL_DRAFT`.

## Security Considerations

None — purely UI state and persistence migration. No new network surface.

## Next Steps

Phase 3 wires the source count into Step 2's operation gating.
