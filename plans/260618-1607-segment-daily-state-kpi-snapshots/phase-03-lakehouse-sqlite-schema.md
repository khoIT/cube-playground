---
phase: 3
title: Lakehouse + SQLite schema
status: completed
priority: P1
effort: 0.5d
dependencies:
  - 1
  - 2
---

# Phase 3: Lakehouse + SQLite schema

## Overview

Create the two new Iceberg tables (`segment_member_state_daily`, `segment_kpi_daily`),
each carrying `snapshot_ts` and keyed **per segment** (per the Phase-2 cadence model),
and add `snapshot_ts` to the existing membership/delta/definition tables. The
state-table columns are generated from `CANONICAL_USER_STATE_COLUMNS` (Phase 1) so the
schema can never drift from the writer.

> Table names keep the `_daily` suffix for continuity with the shipped membership
> tables even though they now hold sub-daily rows; `snapshot_ts` is the true grain.

## Requirements

- Functional: `ensureLakehouseTables()` creates both new tables idempotently and adds
  `snapshot_ts` to the existing three.
- Functional: state-table columns generated from the canonical set (key → sqlType), in
  the stable order the writer uses.
- Non-functional: partitioning tuned for per-segment + per-day pruning; `snapshot_ts`
  as a sort/filter column (avoid 96-partition/day explosion at 15m).
- Non-functional: fixed superset of columns (pruned columns = NULL for that game).

## Architecture

### `segment_member_state_daily` (per segment, per snapshot, per uid)

```sql
CREATE TABLE IF NOT EXISTS segment_member_state_daily (
  snapshot_date DATE,
  snapshot_ts   TIMESTAMP,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  uid           VARCHAR,
  -- generated from CANONICAL_USER_STATE_COLUMNS (minus uid):
  ingame_name VARCHAR, ltv_vnd DOUBLE, ltv_30d_vnd DOUBLE,
  is_paying_user VARCHAR, is_paying_30d VARCHAR,
  total_active_days BIGINT, days_since_last_active BIGINT,
  days_since_last_recharge BIGINT, max_role_level BIGINT,
  lifecycle_stage VARCHAR, churn_risk VARCHAR, engagement_segment VARCHAR,
  payer_tier VARCHAR, country VARCHAR, os_platform VARCHAR,
  last_active_date DATE, install_date DATE
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  sorted_by    = ARRAY['snapshot_ts', 'uid'],
  format       = 'PARQUET'
);
```

- Grain: one row per (snapshot_ts, game, segment, uid). Per-segment keying (a uid in N
  segments → N rows/snapshot) because cadence is per-segment.
- Partition by (date, game, segment) — NOT by ts (a 15m segment = 96 ts/day in one
  date partition, sorted by ts → cheap range scans without partition explosion).
- Idempotent per (snapshot_ts, game, segment): DELETE the slice, INSERT.

### `segment_kpi_daily` (segment KPI time-series, tall)

```sql
CREATE TABLE IF NOT EXISTS segment_kpi_daily (
  snapshot_date DATE,
  snapshot_ts   TIMESTAMP,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  metric_id     VARCHAR,   -- Cube measure ref, e.g. 'mf_users.ltv_total_vnd'
  metric_label  VARCHAR,
  value         DOUBLE,    -- NULL when the KPI query returned no row
  member_count  BIGINT
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  format       = 'PARQUET'
);
```

- Tall shape: one row per (snapshot_ts, game, segment, metric). Adding/removing a KPI
  never changes the schema. Idempotent per (snapshot_ts, game, segment).

### Existing tables

- Add `snapshot_ts TIMESTAMP` to `segment_membership_daily`, `_delta`,
  `_definition_daily` (additive). Existing rows → `snapshot_date 00:00`.

### SQLite observability

- `segment_snapshot_log` already has `status`/`detail`; write per-stage rows with
  `detail` prefixed `state:` / `kpi:` and include the `snapshot_ts`. Add a `stage`
  column only if the admin board needs it (migration `064-snapshot-stage.sql`,
  nullable; existing = `membership`).

## Related Code Files

- Modify: `server/src/lakehouse/segment-membership-ddl.ts` (2 new DDLs + `snapshot_ts`
  on existing 3; generate state columns from the canonical set), `lakehouse-trino-connector.js`
  (export `SEGMENT_MEMBER_STATE_DAILY`, `SEGMENT_KPI_DAILY`).
- Create (if needed): `server/src/db/migrations/064-snapshot-stage.sql`.
- Read: Phase 1 `canonical-metric-set.ts`, Phase 2 cadence/ts contract.

## Implementation Steps

1. Build state-table column DDL by iterating `CANONICAL_USER_STATE_COLUMNS` + `sqlTypeFor`.
2. Add both `CREATE TABLE IF NOT EXISTS`; add `snapshot_ts` to the existing three.
3. Export the two qualified table-name constants.
4. Decide log-stage approach (prefer detail-prefix; migration 064 only if needed).
5. Verify tables create cleanly on the local lakehouse connector; describe matches order.

## Success Criteria

- [ ] Both tables created idempotently (re-run no-op); existing 3 gain `snapshot_ts`.
- [ ] State columns generated from the canonical set (no hand-maintained duplicate).
- [ ] Partitioning is (date, game, segment); `snapshot_ts` sorts within partition.
- [ ] Qualified-name constants exported for Phase 4/5.
- [ ] `npm run server:build` clean.

## Risk Assessment

- **Partition explosion at 15m** → avoided by partitioning on date (not ts) + sort-by-ts.
- **Schema/writer drift** → eliminated by generating both from one ordered array.
- **Migration number collision** (parallel sessions) → confirm next free number at impl;
  062 current highest, 063 used by Phase 2.
