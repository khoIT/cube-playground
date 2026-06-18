---
phase: 8
title: "Tests + docs"
status: pending
priority: P2
effort: "0.5d"
dependencies: [4, 5, 6, 7]
---

# Phase 8: Tests + docs

## Overview

Lock behavior with tests across cadence, both writers, the reader (incl. mixed-cadence
downsample), and the UI; update docs + lessons-learned + memory.

## Test plan

- `snapshot-cadence.test.ts` — `floorToCadenceBucket` (daily → GMT+7 midnight; 15m/1h
  buckets), `cadenceElapsed` true/false; default daily.
- `canonical-metric-set.test.ts` — `segmentKpiSpecsForPreset` dedupe; column ordering; pruning.
- snapshot-job test — per-segment cadence: a `1h` segment fires ~hourly, a `daily` once/day,
  15m base tick doesn't double-run daily; manual trigger forces all; window respected.
- `segment-member-state-writer.test.ts` — projection has no segment filters; reused per
  (game, ts); per-segment keying (uid in N segments → N rows/ts); idempotent per snapshot_ts; missing col → NULL.
- `segment-kpi-writer.test.ts` — one row per (snapshot_ts, segment, metric); NULL on empty
  cohort; reuses card-runner; filters == card-runner filters.
- `downsample-snapshots.test.ts` — last-in-bucket for gauges + accumulators (never sum);
  **mixed hourly→daily collapses to one coherent point/day**; finer-than-captured → carry-forward flag; `effective_granularity` + `cadence_changes` correct.
- `segment-movement-reader.test.ts` / `-route.test.ts` — bounded range; query correctness;
  serve-stale; param validation; redaction parity.
- `movement-tab.test.tsx` — sections render; granularity toggle clamps to `effective_granularity`;
  cadence-change markers; step/carry-forward in daily era; empty/stale states.

## Docs to update

- `docs/system-architecture.md` — snapshot section: per-segment cadence + `snapshot_ts`,
  the two new tables, the per-(game,ts) mf_users projection + Trino JOIN, KPI time-series
  via card-runner, the view-time downsample + mixed-cadence display rule.
- `docs/lessons-learned.md` — entries: "predicate-free mf_users projection + Trino JOIN
  avoids per-segment join-rooting"; "segment KPIs reuse card-runner, never derive from
  per-user state (ratios/threshold/foreign cubes)"; "snapshots are as-of values → downsample
  by last-in-bucket, never sum; mixed cadence collapses cleanly to coarser, steps toward finer".
- `docs/codebase-summary.md` / `docs/project-changelog.md` — feature entry.
- `README.md` Segments line — daily/sub-daily movement monitor.
- Memory: update `segment-membership-lakehouse-snapshot` (state + KPI + per-segment cadence
  extension; serve layer now built).

## Implementation Steps

1. Writer/reader/cadence unit tests first (assert invariants, not implementation).
2. Extend snapshot-job test for per-segment cadence + new orchestration.
3. Route + UI tests; downsample/mixed-cadence tests.
4. `npm run server:test`, `npm run test`, `npm run typecheck`, `npm run build` — fix all (no skips).
5. Update docs + lessons-learned + memory. `/ck:code-review` the diff before ship.

## Success Criteria

- [ ] All new tests pass; full server + SPA suites green; tsc + build clean.
- [ ] Invariants each have an asserting test: per-segment cadence, idempotence-per-snapshot_ts,
      per-segment state keying, as-of downsample (no summing), mixed-cadence coherence.
- [ ] Docs + lessons-learned + memory updated.
- [ ] Code review completed (concerns addressed).

## Risk Assessment

- **Trino-dependent tests flaky/cold** → injected connector fakes for units; one tolerant integration smoke.
- **Env-gated job** → tests drive writers + `triggerManualSnapshot` directly, not the env gate.
