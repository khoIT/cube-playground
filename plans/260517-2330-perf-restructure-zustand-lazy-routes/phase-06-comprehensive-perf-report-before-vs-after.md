---
phase: 6
title: "Comprehensive perf report before vs after"
status: pending
priority: P1
effort: "½d"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: Comprehensive perf report before vs after

## Overview

Close the loop. Phase 1 captured a baseline; Phases 2–5 changed code; Phase 6 measures the delta and publishes a single, auditable report so "feel test PASS" is backed by numbers even though we never gated on an SLA.

The report is **the** deliverable for "performance restructure complete". Without it, the next person to ask "did this actually help?" has nothing to point to.

## Requirements

- Functional:
  - Re-run every Phase 1 interaction script on the post-restructure build.
  - Render-count and commit-time deltas per component for the three pain interactions.
  - Bundle-size delta: initial chunk + per-route chunk sizes (from `vite build` output).
  - Network-waterfall delta for one dim-toggle (verifies whether perceived latency was render-bound or network-bound).
  - Multi-tab regression check: open two tabs, run a query in each, swap — capture the renders.
  - Cold start trace comparison.
- Non-functional: report is markdown + screenshots, lives in plan directory, committed.

## TDD Discipline

Not applicable to a measurement phase. Instead:

1. Reuse `src/dev/perf-probe.tsx` from Phase 1 untouched.
2. Run each interaction script exactly as captured in `reports/perf-baseline.md` — same input, same tab state, same data set — for comparable numbers.
3. Two-run rule: first run primes the cache, second run is the trusted measurement (matches Phase 1 protocol).

## Architecture

```
plans/260517-2330-perf-restructure-zustand-lazy-routes/reports/
  ├─ perf-baseline.md            # Phase 1 output (input to this phase)
  └─ perf-before-vs-after.md     # NEW — this phase's deliverable
```

Report sections (template):

```markdown
# Perf — Before vs After

## Methodology
- Build: <commit hash before> vs <commit hash after>
- Browser: <Chrome version>, CPU throttle: 4× slowdown, network: Fast 3G
- Probe: src/dev/perf-probe.tsx (Phase 1)
- Interaction scripts: identical to perf-baseline.md
- Two-run rule applied; second-run numbers reported.

## Interaction 1 — Dim/measure toggle (Query Builder)

| Metric | Before | After | Δ |
|---|---|---|---|
| Total React commits | 28 | 6 | −79% |
| QueryBuilderSidePanel render count | 14 | 1 | −93% |
| Sum actualDuration (ms) | 184 | 22 | −88% |
| Network dry-run requests | 1 | 1 | — |
| LCP after click | 320ms | 60ms | −81% |

Screenshots: [trace-before.png] [trace-after.png]

## Interaction 2 — Tab switch (Build → Catalog → Build)

| Metric | Before | After | Δ |
|---|---|---|---|
| Initial chunk size (gz) | … | … | … |
| Per-route chunks | 0 | 4 | new |
| Script eval on tab switch (ms) | … | … | … |
| Background-page renders | … | 0 | … |
| Result-set survival on return | yes | yes | — |

## Interaction 3 — Cold start → first click

| Metric | Before | After | Δ |
|---|---|---|---|
| Time to interactive (ms) | … | … | … |
| Initial JS parse (ms) | … | … | … |
| First meaningful paint (ms) | … | … | … |

## Multi-tab regression check

| Scenario | Result |
|---|---|
| Two tabs, distinct queries, swap | Each tab keeps its own query / result / pivot. No collapse. |
| Same tab, run query, swap route, return | Result + executed query persist via store. No spinner. |
| Mid-flight query, swap route | AbortController cancels cleanly. No unmounted-setState warning. |

## UX regression check

| Surface | Status |
|---|---|
| Playground happy path | unchanged |
| Deep link `?query=…` | unchanged |
| Deep link `#/build?cube=…&measure=…` | unchanged |
| Catalog browse + detail panel | unchanged |
| Metric card route | unchanged |
| New Metric 6-step happy path | unchanged |
| SecurityContext token swap | unchanged |
| Live-preview flow | unchanged |

## Phase-by-phase contribution

| Phase | Primary win | Captured delta |
|---|---|---|
| 2 — Lazy routes | Cold start, tab-switch script eval | … |
| 3 — Zustand stores | Per-instance state isolation | … (informational) |
| 4 — SidePanel + auto-name | Click-on-dim render count | … |
| 5.0 — Surgical fix | Provider memo + clone removal | … |
| 5.B–F (if shipped) | Context teardown | … |

## Verdict

Feel-test PASS: ☐ yes / ☐ no
SidePanel dim-toggle render count drop: ___% (Validation Session 1 gate: ≥50%)
Quantified: N% improvement on dim toggle, M% on tab switch, K% on cold start.
Recommended follow-ups: …

### If FAIL (Validation Session 1)

Phase 1-5 changes are NOT reverted — they are net-positive even when the perf target under-shoots. Instead:

1. Identify the offending component(s) via the Phase-by-phase contribution table.
2. Identify whether the residual latency is render-bound, network-bound, or paint-bound (network waterfall section).
3. Write a follow-up plan (e.g. dry-run debouncing, request coalescing, custom-equality memo on a hot child) — separate file under `plans/`.
4. Link the follow-up from this report.
<!-- Updated: Validation Session 1 — FAIL handling = follow-up plan, no rollback -->

## Unresolved questions

…
```

## Related Code Files

- Create: `plans/260517-2330-perf-restructure-zustand-lazy-routes/reports/perf-before-vs-after.md`
- Read-only: `reports/perf-baseline.md` (Phase 1 output)
- No code changes in this phase.

## Implementation Steps

1. Read `reports/perf-baseline.md`. Confirm every interaction script is reproducible.
2. Check out the post-Phase-5 commit. `npm run build`; record initial + per-route chunk sizes.
3. Run dev server; reset `window.__perfCounts = {}` before each interaction.
4. Execute Interaction 1 (dim toggle ×5). Capture Performance trace, React DevTools Profiler ranked view, network waterfall, `__perfCounts` snapshot.
5. Execute Interaction 2 (tab switch Build → Catalog → Build). Capture trace + chunk-load waterfall.
6. Execute Interaction 3 (cold start hard-refresh → first click). Capture LCP, FCP, TTI.
7. Execute multi-tab regression scenario explicitly (UX-untouched contract).
8. Manually verify the UX-regression matrix (each surface unchanged).
9. Fill in the report template above. Commit screenshots + report.
10. Update plan.md status to `completed` once the verdict is recorded.

## Success Criteria

- [ ] `reports/perf-before-vs-after.md` committed with all 3 interaction deltas filled in.
- [ ] Bundle-size table populated from real `vite build` numbers.
- [ ] Multi-tab regression scenario explicitly tested and pass/fail recorded.
- [ ] UX-regression matrix populated; every surface marked unchanged or remediated.
- [ ] Verdict line stated (PASS/FAIL with one-sentence rationale).
- [ ] Plan-level success criterion "Phase 6 produces `reports/perf-before-vs-after.md`" satisfied.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Numbers move in unexpected ways (e.g. one phase regressed something) | Phase-by-phase contribution table lets us pinpoint the offender; can re-run with intermediate commits if needed. |
| "Feel test" subjective and numbers contradict | Numbers are informational; verdict is "yes" iff the user agrees. The report exists for accountability, not as a gate. |
| Cache pollution between before/after runs | Two-run rule + explicit `window.__perfCounts = {}` reset + DevTools "Disable cache" in network tab. |
| Network-bound latency dominates render-count wins | Network waterfall captured per interaction; if dim toggle is network-bound, report calls it out and proposes a follow-up plan for request coalescing / dry-run debouncing. |
| Phase 5 stopped at 5.0 gate; report-template assumes full migration | Template explicitly accommodates "if shipped" rows; verdict still recordable when Steps 5.A–F are skipped. |
| Verdict FAIL with no rollback plan | Resolved (Validation Session 1): FAIL triggers a follow-up plan, not rollback. Phase 1-5 stay shipped. Report names the offending phase + component for the follow-up. |
