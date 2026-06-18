---
phase: 5
title: Segment KPI time-series writer
status: completed
priority: P1
effort: 1d
dependencies:
  - 2
  - 3
---

# Phase 5: Segment KPI time-series writer

## Overview

Persist the segment-level KPIs the Insights tab already computes as a **time-series**
in `segment_kpi_daily`, one set per `snapshot_ts` at the segment's cadence. These KPIs
span `mf_users`/`recharge`/`etl_game_detail` and include non-additive ratios — so they
are computed by **reusing `card-runner.queryForKpi`**, not derived from per-user state.
This is where the **intraday signal** lives (revenue-so-far, DAU climbing, CCU).

## Requirements

- Functional: per segment firing at this tick, compute every canonical KPI for its
  preset (Phase 1 `segmentKpiSpecsForPreset`, pruned per game), scoped to membership,
  and write one row per (snapshot_ts, segment, metric).
- Functional: idempotent per (snapshot_ts, game, segment) — DELETE then INSERT.
- Functional: NULL value when a KPI query returns no row (empty cohort) — row present, value NULL.
- Non-functional: reuse `card-runner`'s query path so persisted value == Insights-tab value (zero drift).
- Non-functional: as-of-`snapshot_ts` semantics.

## Architecture

### Compute (reuse card-runner)

`card-runner.queryForKpi(kpiSpec, { segmentFilters, prefix, token })` already runs each
KPI scoped to a segment. The writer:

1. Resolve the segment's preset id + `segmentFilters` (reuse `refresh-segment.ts`
   plumbing; do not re-derive).
2. `segmentKpiSpecsForPreset(presetId)` → KPI list (pruned per game).
3. For each spec, `queryForKpi(...)` → numeric value (or null). Collect
   `{ metric_id, metric_label, value }[]`.
4. `member_count` = the membership count already produced this tick (pass it in).

### Write (app-side VALUES — these are Cube reads, not Trino SELECT)

- `INSERT INTO segment_kpi_daily (... snapshot_ts ...) VALUES (…), (…)` — small scalars,
  multi-row VALUES with safe literals (`toSqlLiteral`; NULL for null). DELETE the
  (snapshot_ts, game, segment) slice first. NOT a cross-catalog SELECT.
- Iceberg is the time-series of record; optional SQLite mirror only if Phase 6 needs
  sub-second reads without Trino (default: Iceberg-only, matching membership).

`writeSegmentKpiSnapshot(segment, snapshotTs, memberCount, opts)` → structured result;
never throw per-segment.

### Orchestration

In `snapshot-segment-membership.ts`, inside the per-segment loop after a successful
membership write (member_count known), call `writeSegmentKpiSnapshot`. Runs at the
segment's cadence; manual trigger covered. Log via heartbeat (`detail:'kpi:…'`).

### Why not derive from per-user state

`paying_rate_30d` (ratio), `arppu_vnd` (÷payers), `whales_count` (thresholded), and all
`recharge.*` / `etl_game_detail.*` KPIs are not in the per-user `mf_users` snapshot.
Deriving them from `segment_member_state_daily` would be wrong/impossible — card-runner
is the single correct source.

## Related Code Files

- Create: `server/src/lakehouse/segment-kpi-writer.ts`.
- Modify: `server/src/jobs/snapshot-segment-membership.ts` (per-segment KPI write).
- Read/reuse: `server/src/services/card-runner.ts` (`queryForKpi`), `refresh-segment.ts`
  (preset + segmentFilters resolution), Phase 1 module, Phase 3 table const, `inline-sql-params.ts`.

## Implementation Steps

1. Factor "resolve preset id + segmentFilters for a segment" into a reusable helper if not standalone.
2. Implement `writeSegmentKpiSnapshot`: KPI specs → `queryForKpi` each → multi-row INSERT…VALUES (NULL-safe).
3. DELETE slice then INSERT; structured result with metric count.
4. Wire into the job per segment; pass through membership `member_count`.
5. Skip with reason if preset has zero KPI specs (unknown preset).

## Success Criteria

- [ ] `segment_kpi_daily` has one row per (snapshot_ts, segment, metric) for each canonical KPI of the preset.
- [ ] Persisted value == Insights-tab value for the same snapshot (spot-check 2 metrics).
- [ ] Empty-cohort segment writes NULL values (rows present), not zero rows.
- [ ] Sub-daily test segment yields multiple `snapshot_ts` points/day; daily once/day.
- [ ] recharge-events + etl_game_detail presets persist their non-mf_users KPIs.
- [ ] Re-run same `snapshot_ts` idempotent. `npm run server:build` + vitest pass.

## Risk Assessment

- **N segments × M KPIs × ticks/day Cube reads** → bounded; only opted-in sub-daily
  segments multiply. If volume bites, batch specs per segment into one multi-measure
  Cube query (optimization, not v1). Log read counts.
- **segmentFilters drift vs card cache** → reuse the exact resolution path; test asserts equality.
- **Ratio/threshold correctness** → guaranteed by reusing card-runner (the code the UI trusts).
