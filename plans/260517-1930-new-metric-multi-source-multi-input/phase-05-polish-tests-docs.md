---
phase: 5
title: "Polish, tests, and docs"
status: pending
priority: P2
effort: "0.5d"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Polish, tests, and docs

## Overview

Wrap up: end-to-end smoke tests for the three canonical flows, walkthrough doc / README updates, summary chip polish across the wizard chrome, and retire any remaining single-source assumptions surfaced during phases 2-4.

## Requirements

- E2E happy paths verified manually + by snapshot/component tests:
  1. 1 source + Sum → emits expected YAML; identical bytes to pre-change baseline.
  2. 1 source + Ratio → Ratio card visibly disabled; clicking it sends user back to Step 1.
  3. 2 sources (same parent) + Ratio cross-cube → both slot grids populate; YAML emits cross-cube `{a}.x / NULLIF({b}.y, 0)`.
- Walkthrough doc / changelog / `docs/codebase-summary.md` updated to reflect the multi-source flow.
- All `selectedCube` references in the wizard's chrome (top bar, left rail identity, validation card) use the primary cube and degrade gracefully when no source is picked.
- No remaining usages of the removed `OperationAccepts` type or the deleted `ofMember` / `ofMemberB` setters.

## Architecture

No new architecture in this phase — only consolidation. Two specific cleanups:

### Top bar / shell

`shell/top-bar.tsx` and `shell/validation-card.tsx` currently bind to single-source state. Audit both for `draft.sourceCube` references and rewrite to use `draft.sourceCubes[0]` (or a count summary where appropriate).

### Identity rail / YAML preview

`left-rail.tsx` identity hero and `step-5-identity/yaml-preview-rail.tsx` need to show:
- single cube → today's behavior unchanged.
- 2+ cubes → primary cube headline, `+N more` chip, hover tooltip listing all selected.

YAML preview rail shows the rendered YAML against the primary cube; cross-cube refs render verbatim.

## Related Code Files

**Wizard chrome cleanup:**
- Modify: `src/QueryBuilderV2/NewMetric/full-page/shell/top-bar.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/shell/validation-card.tsx`
- Modify: `src/QueryBuilderV2/NewMetric/full-page/shell/left-rail.tsx` (already touched in Phase 2 — final polish pass)
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/yaml-preview-rail.tsx`

**Step 6 test-run multi-source support** (validation decision — included in this plan, not punted):
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-body.tsx` — pass `sourceCubes[0]` (primary) as `cubeName` in all 6 read sites (lines 84, 87, 98, 104, 148, 203); for cross-cube ratio the test SQL is emitted by the YAML emitter (Phase 1) which already produces a cross-cube `{a}.x / NULLIF({b}.y, 0)` expression — no extra join logic needed at this site. Test the SQL preview shows valid cross-cube SQL by manually running ratio with 2 cubes through Step 6.

**Docs (validation decision — three files created fresh per CLAUDE.md's documentation-management contract):**
- Create: `docs/codebase-summary.md` (initial content: high-level New Metric wizard architecture + multi-source schema diagram + slot model; can be extended in future plans)
- Create: `docs/project-changelog.md` (initial content: "New Metric: multi-source selection + N-slot inputs (Ratio cross-cube)" as the first changelog entry, with date and brief description)
- Create: `docs/development-roadmap.md` (initial content: list current shipped features incl. this multi-source feature; placeholder for upcoming work)

**Tests:**
- Create: `src/QueryBuilderV2/NewMetric/full-page/__tests__/wizard-multi-source.test.tsx` (component-level smoke test covering the three canonical flows)

## Implementation Steps

1. Grep for remaining `draft.sourceCube` (singular) usages across `src/QueryBuilderV2/NewMetric/full-page/**` and `src/QueryBuilderV2/NewMetric/sections/**`. Rewrite each to the primary-cube derivation (or the count, depending on intent). Most call sites are migrated in Phase 1; this pass catches stragglers in chrome (top-bar, validation-card) and the test-run body. <!-- Updated: Validation Session 1 - chrome cleanup explicitly scoped -->
2. Grep for `OperationAccepts` and `ofMember` / `ofMemberB` setters. Remove or replace per the Phase 1 migration contract.
3. Polish identity hero copy for the `1 cube` and `2+ cubes` cases. Add a tooltip on the `+N more` chip.
4. Update `yaml-preview-rail.tsx` to display the YAML against the primary cube; verify cross-cube refs render verbatim.
5. Write `wizard-multi-source.test.tsx` covering:
   - 1 cube + Sum end-to-end → final YAML matches snapshot.
   - 1 cube + Ratio → operation card has `aria-disabled` and clicking it calls `back()`.
   - 2 cubes + Ratio + cross-cube measures → final YAML matches snapshot.
6. Update `docs/codebase-summary.md` New Metric section: schema diagram (sourceCubes + inputs), gate logic, slot model.
7. Add a changelog entry under `docs/project-changelog.md` ("New Metric: multi-source selection + N-slot inputs (Ratio cross-cube)").
8. Mark roadmap item complete in `docs/development-roadmap.md`.
9. Final manual smoke run in the browser with the dev server (`pnpm dev`) — three flows above.

## Success Criteria

- [ ] `rg "draft.sourceCube\b"` returns zero hits outside the compat shim in `useNewMetricDraft`.
- [ ] `rg "OperationAccepts"` returns zero hits.
- [ ] `rg "ofMember\b|ofMemberB\b"` returns zero hits outside the compat shim and the legacy `OfSection`/YAML emitter call paths (which already migrate inputs).
- [ ] All three canonical flows pass component tests and a manual browser walkthrough.
- [ ] `docs/codebase-summary.md`, `docs/project-changelog.md`, `docs/development-roadmap.md` updated.
- [ ] `pnpm -s tsc --noEmit` clean. NewMetric unit + new component tests green.

## Risk Assessment

- **Doc drift.** Three doc files touched; easy to forget one. Mitigation: explicit greps in step 1/2 + a doc-changes checkbox in the PR.
- **Compat shim left as permanent debt.** Dialog flow still depends on the shim. Mitigation: NOT removed in this plan (out of scope). Filed as a follow-up: retire the dialog flow entirely once the full-page rollout is GA.

## Security Considerations

None.

## Next Steps

Follow-up plan candidates (not in this plan):
- Retire the legacy `NewMetricDialog` and the compat shim in `useNewMetricDraft`.
- Implement undo for the auto-reset behavior in Phase 3.
- Add a third multi-input op (e.g. weighted average) using the N-slot schema to validate the contract holds beyond Ratio.
