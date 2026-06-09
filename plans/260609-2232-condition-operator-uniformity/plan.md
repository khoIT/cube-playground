# Condition operator uniformity + redesign-faithful trigger section

Date: 2026-06-09 · Branch: main · Status: in-progress

## Problem
On `/dashboards/cs/playbooks/01/edit` the Trigger-condition section (1) shows white
space under the rule-kind dropdown, (2) doesn't match `plans/260609-1654-cs-segment-live-count-sweep/visuals/segment-edit-redesign.html`,
(3) lacks an operator on event/tierStep/percentile kinds.

## Decisions (user-confirmed 2026-06-09)
- Operator semantics: FUNCTIONAL per kind.
  - event: in / not in window (inDateRange ↔ notInDateRange)
  - percentile: ≥ / ≤ (top vs bottom Pn)
  - tierStep: ≥ (reaches) — shown, fixed
  - abs / ratio: unchanged (already functional)
- Rule-kind picker: segmented control (match redesign).

## Root cause — white space
"Rule kind" <select> wrapped in <Field> (flex:'1 1 180px') inside a flexDirection:column
container → flex-basis 180px reserves vertical height. Segmented control replaces it.

## Edits already drive the sweep
override → mergePlaybooks → compileRule → predicate; both global + per-segment sweeps
run through runCaseSweep → mergePlaybooks. New ops flow through compileRule the same way.

## Files
1. server/src/types/predicate-tree.ts — add notInDateRange to LeafOperator
2. server/src/services/translator.ts — map notInDateRange + relative-window expansion
3. server/src/care/threshold-rule.ts — EventRule.op?, PercentileRule.op?; compileRule honors
4. server/src/routes/care-playbook-validation.ts — optional op on event/percentile; leafOps += notInDateRange
5. src/types/threshold-rule.ts — mirror op fields
6. src/pages/Dashboards/cs/playbook-builder.tsx — segmented control + Member/Operator/Value layout
7. src/pages/Dashboards/cs/case-snapshot-summary.ts — render "not in <window>" / "≤ Pn"

## Tests
- care-playbook-registry.test.ts: event op → notInDateRange; percentile op → lte cutoff
- translator.test.ts: notInDateRange relative-window expansion
- case-snapshot-summary.test.ts: "not in <window>", "≤ Pn"

## Success criteria
- No white space; section matches redesign.
- Every kind exposes an operator; event/percentile ops change the compiled predicate.
- Edited op reaches both global + per-segment sweep (compileRule path).
- All server + FE tests green; no contract breaks (op fields optional/backward-compatible).
