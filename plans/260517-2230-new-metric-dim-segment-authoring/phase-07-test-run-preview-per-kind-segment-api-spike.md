---
phase: 7
title: "Test-run preview per kind segment API spike"
status: completed
priority: P2
effort: "1d"
dependencies: [5, 6]
---

# Phase 7: Test-run preview per kind segment API spike

## Overview

Make Step 6 (Test run) render kind-appropriate previews: measure → scalar+sparkline (no regression), dimension → top-N value-distribution table, segment → cohort-size tile. First task is a spike on the segment-side `cubejsApi.load({ segments: [...] })` shape; if the spike fails, segment preview falls back to SQL-only. Write/discard/rollback machinery untouched.

## Requirements

- **Functional:**
  - `use-test-run.ts` dispatches the post-write query by `artifactKind`:
    - measure: existing scalar + optional time series. **Unchanged.**
    - dimension: `cubejsApi.load({ dimensions: [<cube>.<entry>], measures: [<cube>.<count_measure>], limit: 25, order: { [count]: 'desc' } })` → table view with label / count / share %.
    - segment: spike result. If `load({ segments: [<cube>.<entry>], measures: [<cube>.<count_measure>] })` works → cohort-size tile with "X users, Y% of cube total". If not → SQL-only preview ("This is the SQL that will run as the segment").
  - Test-run body picks the right child renderer per kind. Existing `TestRunBody` extended to switch.
  - Discard / submit / `.bak` flow unchanged.
- **Non-functional:**
  - Spike is **first task** of the phase (cannot ship preview design without verifying the API contract). Document outcome in a 1-pager pinned at the top of this phase file after the spike.
  - Fallback path: SQL-only segment preview is acceptable v1 if spike fails.

## Architecture

```
full-page/steps/step-6-test-run/
├── use-test-run.ts                 (modify — switch by artifactKind)
├── test-run-body.tsx               (modify — render per kind)
├── test-run-measure-view.tsx       (extracted — current scalar+series UI)
├── test-run-dimension-view.tsx     (NEW — top-N table)
├── test-run-segment-view.tsx       (NEW — cohort-size tile OR SQL fallback)
└── test-run-charts.tsx             (unchanged)
```

## Related Code Files

- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/use-test-run.ts` — per-kind query dispatch.
- Modify: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-body.tsx` — kind dispatch.
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-measure-view.tsx` (extracted from current body).
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-dimension-view.tsx`.
- Create: `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-segment-view.tsx`.
- Modify: `src/QueryBuilderV2/NewMetric/api.ts` — already updated in P3 for `kind`; no change here.
- Read for context: existing `use-test-run.ts` (lines 1–280), `test-run-body.tsx`.

## Implementation Steps (TDD — tests first, after spike)

### 0. Read spike result from P1

The segment-API spike now runs in P1 Task 0 (red-team F-14) — its result is documented in `phase-01-foundation-draft-v3-types-and-auto-name.md` under `## Spike result`. Read it before designing the segment view:
- **Pass** → segment-view ships the cohort-size tile.
- **Fail / shape mismatch** → segment-view ships SQL-only fallback.

If you arrive at P7 and the spike result is missing from P1, halt and run the spike before proceeding (P5/P6 design depended on this — escalate the gap).

**SQL-only fallback display (red-team F-8 segment template form):** when fallback is in effect, render TWO blocks:
1. "Segment definition (Cube template form)" — shows raw `flattenToSql` output (e.g. `{country} = 'VN' AND {ltv_vnd} >= 10000000`).
2. "Approximate SQL at query time" — best-effort interpolation using `cube.dimensions[i].sql` from `/meta`. Label clearly: "Cube interpolates template at query time; this is an approximation."

This prevents users mistaking the template form for the actual SQL Cube emits.

### Then TDD (kind-routed)

1. **Write failing tests for `use-test-run` kind dispatch:**
   - measure-mode → existing behavior preserved (mock test).
   - dimension-mode → query body has `dimensions: [qualified]` + `measures: [<cube>.<count>]` + `limit: 25` + `order` clause.
   - segment-mode → if spike passed: query body has `segments: [qualified]` + `measures: [<cube>.<count>]`. If spike failed: hook surfaces SQL-only state, no load() called.
   - Per-kind `previewStatus` transitions correctly: idle → writing → loading → success / error.
2. **Write failing tests for view-routing in `test-run-body.tsx`:**
   - `artifactKind === 'measure'` → renders `TestRunMeasureView` (existing UI extracted).
   - `artifactKind === 'dimension'` → renders `TestRunDimensionView` with table data.
   - `artifactKind === 'segment'` → renders `TestRunSegmentView` (cohort-tile OR SQL-only depending on spike outcome flag).
3. **Implement spike script** (Step 0 above) — run, record result, decide segment fallback.
4. **Extract measure view** into `test-run-measure-view.tsx`. Verify byte-identical UX for measure mode.
5. **Implement `test-run-dimension-view.tsx`** — top-N table: label column, count column, share% bar. Empty state: "Dimension query returned no rows."
6. **Implement `test-run-segment-view.tsx`** — cohort-size tile if spike passed, SQL-only block otherwise.
7. **Implement `use-test-run.ts`** dispatch. Re-use existing write/discard/bak machinery — only the post-write `load()` shape differs per kind.
8. **Manual e2e**:
   - Measure: pick `sum_test_v2` → live preview still works.
   - Dimension: create `payer_tier_v2` → table shows whale/dolphin/minnow/non_payer counts.
   - Segment: create `vn_whales_v2` → cohort tile shows "N users (Y% of total)" OR SQL-only fallback.
   - All three → submit → YAML lands → /meta confirms → "View in Catalog" CTA works.

## Success Criteria

- [ ] Spike result documented in this phase file.
- [ ] All use-test-run kind-dispatch tests green.
- [ ] All view-routing tests green.
- [ ] Measure-mode test run byte-identical to today (manual + automated).
- [ ] Dimension top-N table renders correctly with share% bars.
- [ ] Segment preview: cohort-size tile OR SQL-only fallback (whichever spike supports).
- [ ] Submit + .bak rollback works for all three kinds.
- [ ] One e2e flow per kind documented in PR description.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Spike result reveals `segments:` query field unsupported in this Cube version | Ship SQL-only fallback. Document version mismatch in phase file. File follow-up ticket to upgrade `@cubejs-client/core` if user wants cohort tile in a later phase. |
| Dimension top-N table query needs a count measure that doesn't exist on every cube | Fall back to `cubejsApi.load({ dimensions: [qualified], limit: 25 })` (no count column) → table shows just distinct labels. UI degrades gracefully with "Counts unavailable — no count measure on this cube" note. |
| Multi-segment edge case (segment query returns 0 rows because Cube short-circuits) | Show zero-state explicitly: "0 users match — segment may be too narrow or use unknown columns." Add "View SQL" expandable to help debug. |
| `use-test-run` `runIdRef` stale-token logic needs care when kind switches mid-flow | Bump `runIdRef` on any input change including kind change. Existing pattern from `use-live-preview.ts` is sufficient; test covers stale-token guard. |
| Performance: cohort-size baseline query (cube total `count_distinct`) is expensive | Skip the baseline % calc if cube has no `count_distinct_approx` measure. Show absolute count only. Acceptable degradation. |

## TDD Test Inventory

| Test | What it locks in |
|---|---|
| `use-test-run measure-mode query unchanged` | Regression gate |
| `use-test-run dimension-mode adds dimensions + count + limit` | Dim query shape |
| `use-test-run segment-mode (spike pass) adds segments + count` | Segment query shape |
| `use-test-run segment-mode (spike fail) surfaces SQL-only` | Fallback behavior |
| `test-run-body dispatches view by kind` | View routing |
| `dimension view renders top-N table` | Dim UI |
| `segment view renders cohort tile OR SQL` | Segment UI per spike outcome |
| `runIdRef bumps on kind change` | Stale-token correctness |
