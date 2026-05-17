---
title: "New Metric Multi-Source & N-Slot Inputs"
description: "Extend the full-page New Metric wizard to accept multiple source cubes in Step 1 and generic N-slot inputs in Step 3 so Ratio (and future multi-input ops) gate visibly on source count."
status: completed
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

## Validation Log

### Session 1 — 2026-05-17

**Verification Results (Full tier, 5 phases)**
- Tier: Full
- Claims checked: 22
- Verified: 18 | Failed: 4 | Unverified: 0

**Failures resolved via interview:**
1. **[Fact Checker]** `docs/codebase-summary.md`, `docs/project-changelog.md`, `docs/development-roadmap.md` — none exist; only `docs/journals/` + `ordered-funnel-cube-template.md` present.
   - Decision: Phase 5 creates all three files fresh with initial content per CLAUDE.md's documentation-management contract.
2. **[Contract Verifier]** Plan said "update Step 4 filter dropdown caller" for `useEligibleColumns`. Actual callers: 4 (`operation-body.tsx:117`, `operation-detail-rail.tsx:63`, `column-body.tsx:92`, `filters-body.tsx:186`).
   - Decision: Phase 4 `Related Code Files` expanded to enumerate every caller.
3. **[Contract Verifier]** `useReachableMembers` has a caller at `use-dry-run-sql.ts:57` not mentioned in any phase.
   - Decision: Phase 1 + Phase 4 file lists updated to include the dry-run hook.
4. **[Flow Tracer]** Step 6 `test-run-body.tsx` reads `draft.sourceCube` at 6 sites and emits test SQL with a single `cubeName`. Cross-cube ratio would break at test-run time without explicit fix.
   - Decision: Step 6 multi-source support is included in Phase 5 (primary cube as `cubeName`; YAML emitter's cross-cube ratio SQL flows through unchanged).

**Additional behavioral surfaces enumerated** (verified via grep — 49+ `draft.sourceCube` references total):
- `compute-auto-metric-name.ts` — ratio auto-name template stays `ratio_{primary}` per validation decision.
- `use-active-step.ts` — navigation gate uses `sourceCubes.length >= 1`.
- `use-metric-yaml.ts`, `yaml-preview-rail.tsx` — primary cube only.
- `NewMetricDialog.tsx`, `step-define.tsx`, `step-preview.tsx`, `filter-section.tsx` — legacy dialog flow, covered via compat shim or direct migration.

**Other corrections:**
- `validateDraft` → `validate` (correct exported function name at `use-new-metric-draft.ts:62`).
- `localStorage` persistence confirmed at `use-new-metric-draft.ts:214-305` — Phase 2 hydrate step migrates old `sourceCube`/`ofMember` keys.
- `lucide-react@1.16.0` `Lock` icon verified present.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01..phase-05
- Decision deltas checked: 4 (docs scope, caller scope, auto-name template, Step 6 scope)
- Reconciled stale references: phase-01 (caller list), phase-04 (caller list + bug note for NewMetricPage:348), phase-05 (Step 6 + docs creation), `validate` fn-name correction.
- Unresolved contradictions: 0
