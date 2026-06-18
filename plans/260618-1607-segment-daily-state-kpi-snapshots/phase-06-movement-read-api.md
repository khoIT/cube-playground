---
phase: 6
title: Movement read API
status: completed
priority: P2
effort: 1d
dependencies:
  - 4
  - 5
---

# Phase 6: Movement read API

## Overview

Expose the snapshots over a tokenless read API the monitor view (Phase 7) consumes:
segment KPI time-series, membership in/out movement, and per-user state distribution
trends. **`snapshot_ts` is the true grain** — the API returns native points and
supports a **view-time `granularity` downsample** that stays correct when a segment's
capture cadence changed over the window (hour↔daily). Reads run against the lakehouse
Trino connector, bounded, cached, serve-stale (care-tab pattern).

## Requirements

- Functional endpoints (all `?from&to` bounded, optional `granularity`):
  - `GET /api/segments/:id/kpi-trend?metrics&granularity` → series per metric.
  - `GET /api/segments/:id/movement?granularity` → entered/exited + member_count series.
  - `GET /api/segments/:id/state-distribution?ts&dimension` → bucket counts at a snapshot.
  - `GET /api/segments/:id/state-distribution-trend?dimension&granularity` → stacked over time.
- Functional: **mixed-cadence handling** — when the window spans an hourly era and a
  daily era (capture cadence toggled), the response is coherent (see Architecture).
- Non-functional: bounded date range (cap, e.g. ≤180d daily / ≤14d at 15m); serve-stale
  on Trino error; redaction parity with the members API for unauthenticated callers.
- Non-functional: persisted cache keyed by (segment, endpoint, params); reuse `segment_card_cache` shape.

## Architecture

### Native points + view-time downsample

- Reader returns raw rows at native `snapshot_ts`. When `granularity` is set
  (`15m|1h|3h|6h|12h|daily`), downsample **server-side** by flooring each `snapshot_ts`
  to the target bucket and picking **last-in-bucket (close)** per series:
  - Point-in-time gauges (ltv_total, member_count, paying_rate, lifecycle counts) →
    last value in the bucket = the as-of value (matches what daily-only capture records).
  - "Today-so-far" accumulators (revenue, txns) → last-in-bucket = the bucket's final
    cumulative value; sub-daily view shows the running curve. (Do NOT sum across
    snapshots — each snapshot is already an as-of cumulative value, not a delta.)
- Distribution & state are inherently per-`snapshot_ts`; downsample = pick the
  last snapshot in each bucket.

### Mixed-cadence (hour ↔ daily) — the key case

- A segment captured hourly for week 1 then daily for week 2 yields dense then sparse
  points. The downsample is **lossless toward coarser** and **clamped toward finer**:
  - Downsampling to `daily`: hourly era collapses to one close-point/day → identical
    shape to a daily-only segment. Fully coherent across the change.
  - Requesting `granularity` **finer than the captured cadence** for a sub-range:
    return the captured points as-is (no synthetic upsampling); flag those buckets so
    the UI renders a **step** (carry-forward) rather than implying missing detail.
- Response carries:
  - `points: [{ ts, …values }]` (already downsampled if `granularity` given),
  - `effective_granularity` (the coarsest cadence present in the window — the finest the
    UI should let the user pick without gaps),
  - `cadence_changes: [{ ts, from, to }]` (derived from `segment_definition_daily` /
    a cadence-history; annotate the chart),
  - `as_of` (latest `snapshot_ts`) + freshness for the badge.
- Cadence-change history source: log cadence at snapshot time. Cheapest is to stamp the
  active `snapshot_cadence` into `segment_definition_daily` per snapshot (Phase 2/3 add
  a `snapshot_cadence` column there) → the API derives change points by lag.

### Reader queries

- kpi-trend: `SELECT snapshot_ts, metric_id, value FROM segment_kpi_daily WHERE
  segment_id=? AND game_id=? AND snapshot_date BETWEEN ? AND ? [AND metric_id IN (…)]
  ORDER BY snapshot_ts` → group → (optional) downsample.
- movement: `segment_membership_delta` GROUP BY snapshot_ts, change; member_count from `segment_kpi_daily`.
- distribution(-trend): `membership ⋈ member_state` on (snapshot_ts, game, segment, uid),
  GROUP BY snapshot_ts, `<dimension>`.

## Related Code Files

- Create: `server/src/routes/segment-movement.ts`, `server/src/lakehouse/segment-movement-reader.ts`,
  `server/src/lakehouse/downsample-snapshots.ts` (pure bucket-floor + last-in-bucket; unit-testable).
- Modify: route registration; Phase 2/3 `segment_definition_daily` to carry `snapshot_cadence`.
- Read/reuse: `segments.ts` (redaction, `:id`), `lakehouse-trino-connector.js`,
  `segment-care-cache-store.ts` (serve-stale), Phase 1 (labels).

## Implementation Steps

1. Build the bounded reader queries (params via `toSqlLiteral`).
2. Implement `downsample-snapshots.ts` (floor-to-bucket + last-in-bucket; carry-forward flag).
3. Compute `effective_granularity` + `cadence_changes` from the cadence-history column.
4. Add the route module; validate `from/to` (range cap per granularity), `dimension` allow-list, `granularity`.
5. Redaction for unauthenticated callers; serve-stale + persisted cache; chart-ready shapes.

## Success Criteria

- [ ] kpi-trend/movement/distribution return correct series (match manual Trino).
- [ ] `granularity=daily` over a mixed hourly→daily window yields one coherent point/day (hourly era collapsed to close).
- [ ] Requesting finer-than-captured granularity returns captured points + carry-forward flag (no synthetic points).
- [ ] `effective_granularity` + `cadence_changes` present and correct.
- [ ] Range cap, unknown dimension → 400; Trino error with prior payload → 200 stale.
- [ ] Redaction parity for unauthenticated callers. `npm run server:build` + tests pass.

## Risk Assessment

- **Heavy distribution-trend JOIN** → bounded range + cache; partition-pruned by (date, game, segment).
- **Downsample correctness for accumulators vs gauges** → both use last-in-bucket (as-of
  semantics); covered by unit tests. Never sum snapshots.
- **Cadence-history availability** → stamped per snapshot in `segment_definition_daily`; if
  absent (pre-feature rows), treat as daily.
