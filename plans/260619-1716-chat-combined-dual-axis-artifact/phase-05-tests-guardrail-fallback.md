---
phase: 5
title: "Tests + guardrail fallback"
status: completed
priority: P1
effort: "0.5d"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Tests + guardrail fallback

## Overview

Lock the mergeability guardrail + the deterministic two-card fallback, and cover the corrected
end-to-end path. The guardrail is the correctness boundary; the date-value merge and cache-replay
are the regression boundaries the red-team flagged.

## Requirements

- Functional: incompatible/divergent pairs never merge (no empty/misaligned dual-axis); a rejected
  combine always yields two cards (server-side, not model-dependent).
- Non-functional: all existing chat-service + builder + dashboard suites stay green; no new
  lint/type/build errors; `npm run lint` (theme-token) clean.

## Architecture

- **`canMerge` truth table** (chat-service): same grain + same range + disjoint measures → mergeable;
  mismatch (different granularity, different range, overlapping/identical measure, missing or >1
  timeDimension) → rejected with the typed reason.
- **Date-value merge** (`merge-on-date-value` — both the chat-service and FE copies): full-outer over
  the union of dates; asymmetric gap (date present in one series only) keeps the date with a null on
  the missing side — never drops it (red-team H7). Cross-cube prefix-strip aligns the values
  (red-team C1).
- **Coverage-snap divergence** (red-team H8): two cubes at different freshness + relative range →
  snapped ranges differ → refuse → two cards.
- **Deterministic fallback** (red-team M14): `emit_combined_artifact` rejection emits TWO single
  artifacts server-side; assert the turn ends with two artifacts, never zero.
- **Cache-replay** (red-team H10): a combined artifact replayed via `refresh-cached-artifacts`
  retains its overlay (reload+merge both) or is skipped — never degraded to a single series.
- **ChartSpec** (red-team C3): the emitted `dual-axis` spec uses `{category,value,series}`; FE
  renders both columns.
- **FE**: deeplink writer (combined writes both keys + flag; single unchanged; combined degrades to
  primary on a pre-Phase-3 consumer); builder overlay load + center embedded dual-axis render;
  dashboard dual-axis persistence + dual-load round-trip + single-tile back-compat.

## Related Code Files

- Create: `chat-service/src/tools/__tests__/can-merge-queries.test.ts`
- Create: `chat-service/src/tools/__tests__/merge-on-date-value.test.ts`
- Create: `chat-service/src/tools/__tests__/emit-combined-artifact.test.ts` (happy + reject→two-card + snap-divergence)
- Create: `chat-service/src/cache/__tests__/refresh-combined-artifact.test.ts`
- Create: `src/charts/__tests__/merge-on-date-value.test.ts` (FE; mirror chat-service cases)
- Extend: `open-artifact-in-playground` tests (combined sibling key + flag + degrade)
- Extend: builder center dual-axis render test; dashboard tile dual-axis round-trip test

## Implementation Steps

1. `canMerge` truth table first (the guardrail IS the spec).
2. `merge-on-date-value` tests (both copies): cross-cube prefix-strip alignment + asymmetric gaps.
3. chat-service emit tests: happy / reject→two-card / snap-divergence→two-card.
4. cache-replay test: combined artifact keeps overlay.
5. FE tests: deeplink (combined/single/degrade), builder render, dashboard round-trip.
6. Full suites (chat-service + FE) + `npm run lint` — all green before ship.

## Success Criteria

- [ ] `canMerge` truth table fully covered (mergeable + every reject reason).
- [ ] reject + snap-divergence both yield exactly two artifacts (never zero/empty).
- [ ] date-value merge keeps asymmetric-gap dates; cross-cube values align.
- [ ] cache-replay keeps the overlay series.
- [ ] FE deeplink/builder/dashboard tests pass; no regression in existing suites; lint clean.

## Risk Assessment

- Guardrail too strict (rejects valid merges) → tests document the exact accepted shape; widen only
  with a real case.
- Guardrail too loose (mismatched grains/divergent windows) → the misaligned/empty dual-axis this
  plan exists to avoid; the truth table + snap-divergence test are the gate.
