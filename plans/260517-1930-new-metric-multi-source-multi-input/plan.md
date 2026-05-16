---
title: "New Metric Multi-Source & N-Slot Inputs"
description: "Extend the full-page New Metric wizard to accept multiple source cubes in Step 1 and generic N-slot inputs in Step 3 so Ratio (and future multi-input ops) gate visibly on source count."
status: pending
priority: P2
branch: "new_metric"
tags: [feature, wizard, full-page, ratio, multi-input, multi-source]
blockedBy: [260517-1500-new-metric-fullpage-6step-rebuild]
blocks: []
created: "2026-05-17T19:30:00.000Z"
createdBy: "ck:plan"
source: skill
---

# New Metric Multi-Source & N-Slot Inputs

## Overview

The full-page wizard's Step 1 picks one source cube and Step 3 picks one column. Ratio is declared with `accepts: '2-numeric'` but Step 3 only renders a single picker, so the legacy `OfSection` numerator/denominator model has no equivalent in the new flow. Today's validator also blocks cross-cube ratio (`use-new-metric-draft.ts:90-97`).

This plan widens both ends:

- **Step 1 → multi-source.** Users can select 1..N cubes/views. First selected = primary (where the YAML measure is emitted); others expand the reachable-members pool for Step 3.
- **Step 2 → source-count gating.** Each `OperationDef` declares `minSources` (Ratio = 2). Ops where `minSources > selectedCubes.length` render disabled with a visible hint that links back to Step 1.
- **Step 3 → generic N-slot inputs.** Each `OperationDef` declares `inputs: InputSlot[]` (Ratio = `[numerator, denominator]`, scalar ops = `[value]`, Count = `[]`). Step 3 renders one eligibility grid per slot, sourced from the union of selected cubes' reachable members.
- **Cross-cube Ratio is now allowed.** The same-cube restriction in the validator is lifted; the emitter resolves each slot via `ReachableMember` to produce `{cube}.shortName` SQL refs (already supported by `buildSqlRef`).

The InputSlot[] schema is built for N now (only Ratio uses 2 today) so future ops (weighted avg, formula) drop in without re-touching Step 3.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Schema & draft model](./phase-01-schema-draft-model.md) | Pending |
| 2 | [Step 1 multi-source UI](./phase-02-step-1-multi-source-ui.md) | Pending |
| 3 | [Step 2 source-count gating](./phase-03-step-2-source-count-gating.md) | Pending |
| 4 | [Step 3 N-slot inputs](./phase-04-step-3-n-slot-inputs.md) | Pending |
| 5 | [Polish tests docs](./phase-05-polish-tests-docs.md) | Pending |

## Locked Decisions

- **Primary cube semantics.** `sourceCubes[0]` is the primary cube — the YAML measure file is written under it; all other selected cubes are joinable peers. The legacy emitter's reliance on a single `sourceCube` is preserved by reading `sourceCubes[0]` (no emitter rewrite, only the input wrapper changes).
- **Cross-cube ratio is allowed.** The same-cube prefix check in `validateDraft` (`use-new-metric-draft.ts:90-97`) is removed for the multi-source flow. `useReachableMembers` extended to accept a list of source cubes — each slot can resolve to any reachable member from any selected cube.
- **InputSlot schema is the only multi-input contract.** Step 3 no longer reads `op.accepts` directly; it reads `op.inputs[]` and renders one `useEligibleColumns` grid per slot. `accepts` stays on the slot, not the op. `op.accepts` is removed.
- **Backward compatibility for `ofMember`/`ofMemberB`.** Draft schema migrates: `ofMember` → `inputs.value` (scalar) or `inputs.numerator` (ratio); `ofMemberB` → `inputs.denominator`. YAML emitter reads from `inputs` after the migration. The legacy `OfSection` dialog flow keeps working by reading `ofMember`/`ofMemberB` derived from `inputs` (compat shim in `useNewMetricDraft`).
- **No new ops in this plan.** Only Ratio uses N-slot today. Weighted average / formula etc. are out of scope — the schema accommodates them but no UI is added.
- **Custom SQL stays dropped** (carried forward from the 6-step rebuild's red-team #24).

## Dependencies

Blocks on: [`260517-1500-new-metric-fullpage-6step-rebuild`](../260517-1500-new-metric-fullpage-6step-rebuild/plan.md) — the 6-step shell must land first. This plan modifies steps 1–3 within that shell.

## Open Questions

- Should the primary cube be user-pickable (radio inside the source grid) or auto-set to the first selected cube? Default in this plan: auto = first selected. Surface a "primary" badge so it's visible; revisit if the second cube ends up being the more natural home for the measure file.
- Should disabled Ratio in Step 2 be clickable to scroll the user back to Step 1, or purely informational? Default: clickable, with `back()` invoked and a transient highlight on Step 1's source picker.
