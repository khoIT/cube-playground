# Segment Card-Runner Hardening + Refresh-Cadence Affordance

Turns the segment card precompute engine from "works" into "operable + observable",
and makes refresh frequency a first-class, low-load-by-default user choice.

## Background

- `runPresetCards` (server/src/services/card-runner.ts) precomputes ~30 KPI/card Cube
  queries per predicate-segment refresh, writes to `segment_card_cache`, FE Insights tab
  hydrates from it. Today it runs **sequentially**, fails **silently**, has **no aggregate
  time budget**, and exposes **no staleness signal** to users.
- Refresh cadence: cron (server/src/jobs/cron-runner.ts) ticks every 60s and **already
  respects** per-segment `refresh_cadence_min` (NULL = no auto-refresh). A cadence picker
  **already exists** in the detail-header `SegmentHealthPill`. Item 6 re-surfaces it on the
  Monitor tab with stronger affordance + a low-load default — NOT a from-scratch build.

## Phases

| # | Phase | Item | Layer | Status |
|---|-------|------|-------|--------|
| 1 | [Parallelize card-runner](phase-01-parallelize-card-runner.md) | (1) sequential loop | server | ✅ done |
| 2 | [Per-card error observability](phase-02-card-error-observability.md) | (4) silent misses | server + FE | ✅ done |
| 3 | [Aggregate refresh time budget](phase-03-refresh-time-budget.md) | (5) 30s × N stall | server | ✅ done |
| 4 | [Card staleness "as of" signal](phase-04-card-staleness-signal.md) | (2) no freshness UI | FE | ✅ done (tab-level summary) |
| 5 | [Manual-segment cache decision](phase-05-manual-segment-cache-decision.md) | (3) verify intent | decision | ✅ decided: status-quo (live by design) |
| 6 | [Monitor-tab cadence affordance](phase-06-monitor-tab-cadence-picker.md) | (6) refresh-freq UX | FE | ✅ done |

**Implementation note (260605):** Phase 4 shipped as one tab-level freshness summary in
`insights-tab.tsx` (newest `fetched_at` + error count) rather than per-card captions — DRY,
affordant, no drift across 6 card components. Phase 5 status-quo rationale recorded as a code
comment at `refresh-segment.ts` bail (manual = live by design). Cube member prefix
physicalization preserved on every changed path.

## Dependencies

- Phase 3 builds on Phase 1 (aggregate budget needs the bounded-pool loop).
- Phase 4 consumes the per-card status added in Phase 2 (degrades gracefully if skipped).
- Phases 1–4 are server-card-runner-leaning; Phase 6 is independent FE.
- Phase 5 is a product decision that may add an optional sub-task — do it before Phase 4
  so the staleness UI knows whether manual segments will ever have a cache.

## Key constraints (carried from repo rules)

- Design tokens mandatory for any UI (Phases 2, 4, 6) — read docs/design-guidelines.md.
- Predicate-only scoping is verified-correct for ratio measures + >1MB query limit — do NOT
  reintroduce uid-IN inlining on the server path.
- No plan/finding refs in code comments or migration filenames (domain slug only).
- Conventional commits, no AI references.

## Recommended order of execution

1 → 2 → 3 → 5 (decision) → 4 → 6. Phases 1+3 ship together as one server PR;
2 needs a migration; 4+6 are the user-visible polish.

See each phase file for requirements, steps, todos, and risks. Open questions consolidated
at the bottom of each phase + the cross-cutting ones in phase-05 and phase-06.
