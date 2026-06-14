---
phase: 7
title: GATED — materialized segment_metric_daily aggregate
status: completed
priority: P3
effort: 1d
dependencies:
  - 6
---

# Phase 7: GATED — materialized segment_metric_daily aggregate

> **GATE DECISION 2026-06-12: SKIPPED — no gate fired.** Evidence in
> `reports/metric-series-latency-and-phase7-gate-evidence.md`: live P95 ≈ 1.7s
> (gate threshold ~8s); no mart-restatement evidence (immutability UNKNOWN, not
> restated); no volume consumer (only the segment-detail card behind a 1h TTL
> cache). Re-open if any of the three conditions changes.

## Overview
Materialize the **current-members lens only** into `stag_iceberg.khoitn.segment_metric_daily` during the nightly run. DO NOT BUILD unless a gate fires. Cohort lenses (entry/stayers) stay query-time permanently — per-anchor materialization is a cardinality explosion for no information gain.

## Gate (any one fires → build; none → skip phase)
1. Phase 6 recorded P95 > ~8s for current-lens reads on demo segments (UI-unacceptable), OR
2. Phase 2 matrix found marts that are restated or retention-purged (aggregate doubles as the historical freeze), OR
3. A consumer needs current-lens series in dashboards/chat at request volume (cache-miss cost matters).

## Key Insights
- Grain `(snapshot_date, game_id, segment_id, metric_key)` → thousands of rows/day, trivially rebuildable from membership ⨝ marts (derived, never system-of-record).
- Overlap with plan `260610-1709-schema-per-game-membership-rollup` (not started): that plan is the CubeStore-rollup serve-layer route over the SAME tables, including a per-game schema migration. If this phase fires AND Cube serving is wanted, execute 1709's phases 00–02 rather than duplicating a Cube model here — 1709 is marked blockedBy this plan.
- Nightly cost multiplies by segments × metrics — registry-gated metric list keeps it bounded; reuse the serial-loop + heartbeat pattern.

## Requirements
- Functional: nightly append after delta; idempotent per date; reuses Phase 6 registry + lens SQL (current lens) verbatim — one definition of each metric.
- Non-functional: failure isolated per (segment, metric); does not abort membership/delta; heartbeat `__metrics__` row.

## Related Code Files
- Create: `server/src/lakehouse/segment-metric-daily-writer.ts` + test; DDL append to `segment-membership-ddl.sql`
- Modify: `server/src/jobs/snapshot-segment-membership.ts` (post-delta step), Phase 6 reader (serve current lens from aggregate when present, fall back to live join)

## Implementation Steps
1. Confirm gate evidence in plan report (latency numbers / restatement answer). If no gate: mark phase skipped with rationale, done.
2. DDL: `segment_metric_daily(snapshot_date DATE, game_id VARCHAR, segment_id VARCHAR, metric_key VARCHAR, value DOUBLE, member_count BIGINT)` partitioned `ARRAY['snapshot_date','game_id']`.
3. Writer: per (segment, eligible metric) run the Phase 6 current-lens SQL for snapshot_date, DELETE slice → INSERT.
4. Reader switch: current lens reads aggregate first (exists for date range?) else live join.
5. Optional (only with a real consumer): `segment_metrics` Cube model over the aggregate — coordinate with plan 260610-1709, restart serving instance (DEV_MODE=false has no hot-reload).

## Success Criteria
- [x] Gate decision documented with evidence: SKIPPED (see blockquote above + latency report)
- [ ] ~~If built: aggregate matches live join…~~ N/A — not built (gate skipped)
- [ ] ~~Nightly run time increase measured~~ N/A — nothing added to the nightly run

## Risk Assessment
- Drift between aggregate and live join after registry/metric edits → aggregate rows carry the registry's metric semantics at write time; document that history is value-as-computed (this is also the restatement-freeze feature, not a bug).
- Nightly window blowout → cap metrics per game (registry), measure before enabling for all segments.
