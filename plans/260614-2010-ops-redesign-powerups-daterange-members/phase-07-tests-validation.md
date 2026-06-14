---
phase: 7
title: tests-validation
status: completed
effort: 1.5h
---

# Phase 7: Tests + validation

## Overview

**Priority:** P2 · **Status:** pending · **Depends on:** P2–P6. Last phase.

Unit-test the pure functions (window math + cap, query builders, chart adapters), then run
`tsc --noEmit` + `vite build` + code-review. Tests verify the FINAL merged code. Heatmap
won't populate until P1's cube dims deploy — tests assert the QUERY/ADAPTER shape, not live
rows.

## Test matrix (vitest, `src/__tests__/`)

| Area | File | Asserts |
|------|------|---------|
| Window math + cap | extend `ops-window.test.ts` | custom range passthrough; `clampRangeTo31Days`/`isRangeWithinCap`: 30d ok, 31d ok (boundary), 32d rejected/clamped; end≥start; custom → prior null. Inject `today` for determinism. |
| Query builders | extend `ops-overview-aggregate-contract.test.ts` (or new `ops-overview-queries-newcharts.test.ts`) | NO `user_id` dim/filter on spend/dau/cs/payerTier/heatmap builders (no-PII invariant); `topPayersQuery` DOES carry `user_id` + order desc + limit; jus heatmap includes `currency='VND'` filter, cfm does not; heatmap has NO granularity; daily-trend builders have day granularity. |
| Chart adapters | extend `ops-chart-artifact.test.ts` | `heatmapArtifact` emits `type:'heatmap'` + correct encoding keys + columns; bar/concentration adapter shape; dual-axis reuse produces left/right key order. |

Reuse existing test style (the 4 existing ops test files are the template — DRY).

## Validation gates

1. `tsc --noEmit` clean (whole app).
2. `vite build` succeeds.
3. vitest: all ops tests green (new + existing — no regressions).
4. `code-reviewer` pass on the diff (focus: no-PII boundary, token/font compliance, no
   plan-artifact refs in code/comments/filenames, ≤200 LOC per touched file or modularized).
5. **Manual smoke (local):** Overview renders 2/row + 5 charts; custom range refetches +
   blocks >31d; Members table ranks + links. Heatmap shows empty-state placeholder (expected
   pre-deploy) — NOT an error.

## Heatmap deploy caveat (call out in review + ship notes)

The heatmap will render EMPTY until P1's `hour_of_day`/`day_of_week` dims deploy to BOTH dev
+ prod cube registries AND the serving instance restarts (DEV_MODE=false = no hot reload).
This is expected, not a test failure. Post-deploy, re-verify via a `/load` probe or compiled
SQL that the heatmap returns rows. Do not block shipping the other 4 features on it.

## Related code files

- Modify/create: `src/__tests__/ops-window.test.ts`, `ops-overview-aggregate-contract.test.ts`
  (or new `ops-overview-queries-newcharts.test.ts`), `ops-chart-artifact.test.ts`.
- Tester owns test files only (reads impl, never edits it).

## Implementation Steps

1. Extend `ops-window.test.ts` with custom-range + cap cases (incl. 31/32-day boundary).
2. Extend query-builder contract tests with the no-PII / VND-filter / granularity assertions
   for the 6 new builders.
3. Extend `ops-chart-artifact.test.ts` for the new adapters.
4. Run vitest → fix failures (follow recommendations; do NOT mock/cheat to pass).
5. `tsc --noEmit` + `vite build`.
6. Delegate `code-reviewer` on the full diff.

## Todo

- [ ] window/cap tests (custom passthrough, 31 vs 32 boundary, end≥start, custom→no Δ)
- [ ] query-builder invariant tests (no-PII Overview, topPayers has user_id, VND filter, granularity)
- [ ] chart-adapter tests (heatmap, bar/concentration, dual-axis key order)
- [ ] tsc clean + vite build green
- [ ] all vitest pass (no regressions)
- [ ] code-reviewer pass (PII boundary, tokens/font, no plan refs, file sizes)

## Success Criteria

- All new + existing ops tests pass; tsc + build clean; review approved.
- Invariants codified as tests: no-PII Overview, VND filter on jus money, ≤31d cap.
- Heatmap empty-state documented as expected pre-deploy.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cap boundary off-by-one (31 vs 32) untested | MED | Scan guard regresses | Explicit boundary cases in test matrix. |
| Tests assert live heatmap rows (impossible pre-deploy) | MED | False failure | Test query/adapter SHAPE only; never live rows. |
| no-PII invariant not actually enforced | MED | Privacy regression slips | Dedicated assertion that Overview builders lack user_id; topPayers carved out explicitly. |

## Next Steps

On user request: commit (conventional, no AI refs), push (`second` auto-deploys). Then deploy
P1 cube dims to both registries + restart serving instance, and verify the heatmap populates.
