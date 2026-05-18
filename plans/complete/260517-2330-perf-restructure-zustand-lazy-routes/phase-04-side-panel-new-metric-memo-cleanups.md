---
phase: 4
title: "Side panel + new metric memo cleanups"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1, 2, 3]
---

# Phase 4: Side panel + new metric memo cleanups

## Overview

Two targeted refactors that validate the Zustand plumbing under real load and deliver visible click-latency wins BEFORE the big context teardown in Phase 5:

1. `QueryBuilderSidePanel.tsx` — fix the in-place `.sort()` mutation; **[H1]** stabilize upstream array identities (`cubesOrViewsAll`, `filteredCubes`, `usedCubes`) before touching `cubeList` deps; extract `SidePanelCubeItem` rendering to a memoized child that subscribes to its own slice via `qb-ui-store` selectors.
2. `NewMetricPage.tsx` — **[Red Team C6 — scope cut]** the per-step extraction was already done. `source-body.tsx`, `operation-body.tsx`, `column-body.tsx`, `filters-body.tsx`, `identity-body.tsx`, `test-run-body.tsx` all exist; `NewMetricPage.tsx:315-410` `renderStep()` already does `if (step === N) return <StepChrome>...<XBody/>`. Only mount work remaining is **the auto-name effect at lines 92-109** which fires on every shell render. Solution: extract auto-name to its own hook with `useEvent` for the setField calls; memoize `computeAutoMetricName(draft)`.

## Requirements

- Functional:
  - SidePanel: exactly today's filter / sort / open-cube / member-toggle behavior. Sort stable.
  - SidePanel: deselecting a cube via "Used only" toggle no longer triggers full re-render of unrelated cubes (verified via Phase 1 probe counters).
  - NewMetric: identical step-by-step UX. Field state, draft persistence, auto-name behavior, Continue/Back, step-6 submit all bit-identical.
  - **[C6]** Per-step `*-body.tsx` extraction is already complete; this phase does NOT touch those files.
- Non-functional: render count for one dim toggle drops by ≥50% on SidePanel (informational; not gating).

## TDD Discipline

SidePanel:

1. Write `QueryBuilderSidePanel.test.tsx` covering current observable behavior:
   - Sorting: given cubes A, Z, M (+ A in usedCubes) and no filter — order is A, M, Z.
   - In-place mutation absent: original `cubesAndViews` from context unchanged after render (deep-equal snapshot before/after).
   - `cubeList` updates when `displayConfig.isVisible(name)` flips (currently a known gap because dep is incomplete).
   - Toggling a member in cube X does NOT cause cube Y's `SidePanelCubeItem` to re-render (assert via spy on Y's memo wrapper).
2. Implement: replace `arr.sort()` with `[...arr].sort()`; stabilize upstream array identities (H1); wrap `SidePanelCubeItem` in `React.memo` with custom comparison if needed; lift `openCubes`, `filterString`, `viewMode` to `qb-ui-store`.

NewMetric (scope cut per C6 — auto-name effect only):

1. Write `use-auto-metric-name.test.ts` covering current behavior:
   - Auto-name fires only while `draft.name === lastAutoNameRef.current` or empty.
   - Once user types in the name field, auto-name stops overwriting.
   - Title follows the same auto-controlled pattern.
   - Auto-name does NOT fire when the user is on Step 1 without an operation picked (no-op early return).
2. Extract `useAutoMetricName(draft, setField)` hook from `NewMetricPage.tsx:92-109`. Memoize the `computeAutoMetricName(draft)` and `computeAutoMetricTitle(draft)` calls — they currently re-compute on every shell render.
3. Replace inline effect with hook call. Verify shell render count drops; existing per-step `*-body.tsx` rendering is untouched.

## Architecture

```
src/QueryBuilderV2/
  ├─ QueryBuilderSidePanel.tsx           # slimmer; uses qb-ui-store selectors
  └─ components/
      └─ SidePanelCubeItem.tsx           # React.memo, props-equal'd

src/QueryBuilderV2/NewMetric/full-page/
  ├─ NewMetricPage.tsx                       # shell unchanged structurally
  └─ hooks/
      └─ use-auto-metric-name.ts             # new — extracted from NewMetricPage.tsx:92-109
```

[C6] The `step-N-*/` per-step files (`source-body.tsx`, `operation-body.tsx`, etc.) are pre-existing and stay as-is.

## Related Code Files

- Modify:
  - `src/QueryBuilderV2/QueryBuilderSidePanel.tsx`
  - `src/QueryBuilderV2/components/SidePanelCubeItem.tsx`
  - `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` (replace inline auto-name effect with hook call)
- Create:
  - `src/QueryBuilderV2/NewMetric/full-page/hooks/use-auto-metric-name.ts`
  - `src/QueryBuilderV2/NewMetric/full-page/hooks/__tests__/use-auto-metric-name.test.ts`
- Untouched (per C6): the six `step-*-body.tsx` files — they already exist and are correctly wired.

## Implementation Steps

SidePanel (do first, smaller change, more impact):

1. Write the 4 SidePanel behavior tests.
2. Replace `cubesOrViews.sort(...)` with `const sorted = [...cubesOrViews].sort(...)`.
3. **[H1]** Stabilize upstream array identities *before* touching `cubeList` deps:
   - Memoize `cubesOrViewsAll = useMemo(() => selectedType === 'cubes' ? cubes : views, [selectedType, cubes, views])` (note: `cubes`/`views` reference identity from the QB context is unstable today — this gets fixed in Phase 5 when the context is store-backed; for now use `fast-deep-equal` content hash).
   - Memoize `filteredCubes` similarly — `useFilteredCubes` already memoizes internally; the `.map(c => c.name)` was unmemoized in the original. Fix.
   - Replace `usedCubes.join()` / `[...openCubes.values()].join()` with a stable hash: `getQueryHash(usedCubes)` or `Array.from(set).sort().join('|')`.
   - Only THEN add the stabilized identities to `cubeList` deps. Never spread fresh-each-render arrays into the dep list.
4. Migrate `openCubes`, `filterString`, `viewMode` to `qb-ui-store` selectors (one selector call per slice).
5. Wrap `SidePanelCubeItem` in `React.memo`; verify isolation via test.
6. Rerun Phase 1 baseline interactions; compare counters.

NewMetric (auto-name only — per C6):

1. Write `use-auto-metric-name.test.ts` (4 cases above).
2. Extract `useAutoMetricName(draft, setField)` from `NewMetricPage.tsx:92-109`.
3. Memoize `computeAutoMetricName(draft)` and `computeAutoMetricTitle(draft)` inside the hook.
4. Verify shell render count drops on Step 5 name typing; existing step bodies unchanged.

## Success Criteria

- [ ] SidePanel tests pass; sort stable; memo isolation verified.
- [ ] `use-auto-metric-name.test.ts` passes; auto-controlled behavior preserved.
- [ ] Phase 1 baseline rerun: SidePanel render count per dim toggle drops by ≥50% (informational).
- [ ] No UX regression: manual run of QB happy path + NewMetric 6-step happy path.
- [ ] `npm run typecheck` clean.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| **[H1]** `cubeList` memo deps over-completion causes thrash | Test asserts re-render only when the *named* slice changes; if thrash regresses, narrow deps with care, write a regression test. Stabilize upstream arrays first. |
| Auto-name effect extraction breaks the auto-controlled invariant | Tests assert the lastAutoNameRef-pinned behavior survives extraction. |
| `qb-ui-store` writes during render in SidePanel | Move state-resets to `useEffect` / event handlers; no sets in render path. |
| **[C6]** Re-creating files that already exist | Phase explicitly states `step-*-body.tsx` are untouched. Files-to-create list contains ONLY `use-auto-metric-name.ts` and its test. |
