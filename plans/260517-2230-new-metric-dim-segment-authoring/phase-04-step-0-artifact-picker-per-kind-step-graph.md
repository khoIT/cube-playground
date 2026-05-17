---
phase: 4
title: "Step 0 artifact picker per-kind step graph"
status: pending
priority: P1
effort: "0.75d"
dependencies: [3]
---

# Phase 4: Step 0 artifact picker per-kind step graph

## Overview

Wire the wizard shell to render different step graphs per `artifactKind`. Add a Step 0 picker that sits before Source, drives `setArtifactKind`, and lets the user switch kinds (with a confirm dialog when kind-specific sub-state is non-empty). LeftRail, `use-active-step`, and `NewMetricPage.renderStep` become kind-aware. Step bodies for kinds 5/6/7 stub in as "coming next phase" placeholders — they're wired in P5/P6/P7.

**Red-team applied:** F-12 (lastAutoNameRef reset on `artifactKind` change).

## Requirements

- **Functional:**
  - Step 0 = artifact-kind radio (Measure / Dimension / Segment) with one-line descriptions + Continue button.
  - LeftRail renders a different chip list per kind:
    - measure: Source → Operation → Column → Filters → Identity → Test run (existing 6).
    - dimension: Source → Dim kind → Builder → Identity → Test run.
    - segment: Source → Filter tree → Identity → Test run.
  - `use-active-step.ts` returns per-kind step indices, `canGoTo`, `next`, `back`, `doneFlags`.
  - Step 0 switch fires confirm dialog only when kind-specific sub-state is non-empty (`dimBuilder` set, or filter tree non-empty AND segment-mode would lose it).
  - `?v=2` flag and `?cube=` deep-link still work — kind defaults to `'measure'` on fresh load. Reading kind from URL (`?kind=segment`) is optional v1 polish; defer if time is tight.
- **Non-functional:**
  - Measure-mode path: zero visual change once a measure kind is picked (acceptance gate).
  - Hook order in `NewMetricPage.tsx` respected — all new hooks live BEFORE the `!isV2` early-return (existing rule per commit `1edc783`).

## Architecture

```
full-page/
├── NewMetricPage.tsx
│   ├── adds Step 0 to step graph (StepIndex now 0..6 for measure, 0..4 for dim, 0..3 for segment)
│   └── renderStep dispatcher takes artifactKind into account
├── hooks/use-active-step.ts
│   └── returns { step, setStep, canGoTo, next, back, totalSteps, doneFlags } per kind
├── shell/left-rail.tsx
│   └── reads kind, picks chip list from per-kind config
└── steps/step-0-artifact-kind/
    ├── artifact-kind-body.tsx        (NEW — radio + descriptions)
    └── artifact-kind-card.tsx        (NEW — one card per kind w/ icon + tagline)
```

Per-kind step config (drives LeftRail + use-active-step):

```ts
type StepConfig = { id: string; chip: string; summary: () => string };

const stepGraph: Record<ArtifactKind, StepConfig[]> = {
  measure:   [{id:'kind'}, {id:'source'}, {id:'op'}, {id:'column'}, {id:'filters'}, {id:'identity'}, {id:'test-run'}],
  dimension: [{id:'kind'}, {id:'source'}, {id:'dim-kind'}, {id:'builder'}, {id:'identity'}, {id:'test-run'}],
  segment:   [{id:'kind'}, {id:'source'}, {id:'filter-tree'}, {id:'identity'}, {id:'test-run'}],
};
```

## Related Code Files

- Modify: `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — Step 0 case, renderStep dispatcher per kind.
- Modify: `src/QueryBuilderV2/NewMetric/full-page/hooks/use-active-step.ts` — per-kind step graph.
- Modify: `src/QueryBuilderV2/NewMetric/full-page/shell/left-rail.tsx` — reads kind, picks chips.
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-0-artifact-kind/artifact-kind-body.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-0-artifact-kind/artifact-kind-card.tsx`
- Create: `src/QueryBuilderV2/NewMetric/full-page/hooks/__tests__/use-active-step-kind.test.ts`
- Read for context: existing `use-active-step.ts`, `left-rail.tsx`, `step-chrome.tsx`.

## Implementation Steps (TDD — tests first)

1. **Write failing tests for `use-active-step` kind routing:**
   - kind=measure → 7 steps (0=kind, 1..6=existing).
   - kind=dimension → 6 steps (kind, source, dim-kind, builder, identity, test-run).
   - kind=segment → 5 steps.
   - `next()` after last step stays on last step (no overflow).
   - `setStep(7)` on dimension mode clamps to last valid index.
   - `canGoTo` honors `doneFlags`: cannot skip ahead if previous required step incomplete.
2. **Implement per-kind step graph** in `use-active-step.ts`. Map `StepIndex` to `{ kindStep: { id, kindIndex } }`.
3. **Implement `artifact-kind-body.tsx`** — 3 radio cards, one-line tagline each (pull copy from research report):
   - Measure: "How much / how many / what's the avg — one number out."
   - Dimension: "A property of each row — used in WHERE / GROUP BY."
   - Segment: "A reusable named WHERE clause — name a cohort once, reuse everywhere."
4. **Implement `NewMetricPage.renderStep` dispatcher** — switch on `draft.artifactKind` first, then on local step index within that kind. Stub bodies for dim builder + segment filter tree screens (P5/P6 implement).
5. **Implement `LeftRail`** kind awareness — pull chip list from `stepGraph[kind]`.
6. **Implement Step 0 confirm dialog** for kind switching when sub-state is non-empty (incl. non-empty `filterTree` when leaving segment-mode per P1 reducer signal). Use existing `Modal.confirm` pattern from `NewMetricPage.handleDiscard`. Disable the radio while modal is open to prevent double-fire (red-team F-W).
6a. **Implement `lastAutoNameRef` reset on `artifactKind` change (red-team F-12):** add `useEffect([draft.artifactKind])` in `NewMetricPage.tsx` that imperatively clears `lastAutoNameRef.current = ''` and `lastAutoTitleRef.current = ''`. Test: switch dim → measure → dim with no manual name edits → final name is the dim auto-name, not a stale measure one.
7. **Manual smoke test** — click through Measure flow end-to-end (no regression), click through Dimension flow (lands on placeholders for P5), Segment flow (placeholders for P6). Back/Forward navigation correct on each.

## Success Criteria

- [ ] All `use-active-step-kind.test.ts` tests green.
- [ ] Step 0 radio renders 3 kind cards; selecting + Continue advances to Source.
- [ ] LeftRail chip list reflects kind correctly; clicking a chip jumps to that step (if `canGoTo`).
- [ ] Switching kind on Step 0 after sub-state is set → confirm dialog before clearing.
- [ ] `lastAutoNameRef` + `lastAutoTitleRef` reset on `artifactKind` change (test: dim→measure→dim with no manual edit → dim name correct).
- [ ] Measure-mode flow end-to-end: visually unchanged from today (manual smoke).
- [ ] Dimension flow walks through Source → Dim kind (P5 placeholder) → Builder (P5 placeholder) → Identity → Test run (P7 placeholder).
- [ ] Segment flow walks through Source → Filter tree (P6 placeholder) → Identity → Test run (P7 placeholder).
- [ ] `?v=2` deep-link still loads; no console errors.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Hook count changes between kinds → React "rendered fewer hooks" error | All useState/useMemo/useEffect live BEFORE any kind branching in `NewMetricPage.tsx`. Per-kind state lives in `useNewMetricDraft` (already done in P1). Existing rule from commit `1edc783` enforced. |
| LeftRail chip indices drift from `StepIndex` numeric values | Use string IDs (`'source'`, `'filter-tree'`) for chip-to-step mapping, never numeric indices. |
| URL deep-link `?kind=segment` collides with existing `?cube=` parsing | Keep `?kind=` out of v1 scope. Defer to a follow-up polish task. Document in Open Questions. |
| User clicks Step 0 chip from middle of segment flow — confirm dialog spam | Suppress confirm when no sub-state to lose. Test with empty filter tree → no confirm. |

## TDD Test Inventory

| Test | What it locks in |
|---|---|
| `use-active-step measure-mode has 7 steps incl kind` | Step 0 enrolment |
| `use-active-step dimension-mode skips op+column steps` | Per-kind graph |
| `use-active-step segment-mode has only source+filter+identity+test-run` | Per-kind graph |
| `next() clamps to last step` | Bounds safety |
| `canGoTo blocks skipping incomplete required steps` | Done-flag enforcement |
| `manual smoke: measure flow unchanged` | Regression gate (visual) |
