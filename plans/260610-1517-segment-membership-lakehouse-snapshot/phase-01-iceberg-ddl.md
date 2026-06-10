# Phase 01 — Iceberg DDL: daily snapshot + delta tables

**Priority:** P0 (foundation) · **Status:** pending

## Overview
Create the two lakehouse fact tables in `stag_iceberg.khoitn` and confirm the app can
run DDL/DML there. No app code yet — this is the storage contract everything else targets.

## Tables

### `stag_iceberg.khoitn.segment_membership_daily`
Full membership snapshot, one row per member per segment per day.
```
snapshot_date   DATE       -- the day this cohort was materialized
game_id         VARCHAR
segment_id      VARCHAR
uid             VARCHAR     -- the segment's identity dimension value
-- v1 stores identity only; attrs are a cheap columnar add later (YAGNI now)
```
Iceberg props: `partitioning = ARRAY['snapshot_date','game_id']`,
`sorted_by = ARRAY['segment_id','uid']`, `format = 'PARQUET'`.

### `stag_iceberg.khoitn.segment_membership_delta`
Day-over-day change feed for downstream consumers.
```
snapshot_date   DATE       -- date D at which the change is observed (vs D-1)
game_id         VARCHAR
segment_id      VARCHAR
uid             VARCHAR
change          VARCHAR     -- 'entered' | 'exited'
```
Partition `['snapshot_date','game_id']`.

## Decision: partition grain (Open Q1)
Default: partition by `(snapshot_date, game_id)`, **sort** by `segment_id` — gives partition
pruning by day+game and column-stat skipping by segment without exploding file count.
Add `segment_id` to the partition spec ONLY if total segment count stays bounded (<~few hundred)
AND point-by-segment reads dominate. Confirm segment cardinality before deviating.

## Implementation steps
1. Confirm a **write-capable Trino connection** to `stag_iceberg` (Open Q2): host/catalog/creds,
   separate from the Cube read proxy. Capture how the app will issue statements (existing Trino
   client in `server/src`? or add one — check `connectors` table / any `trino`/`presto` client).
2. Author DDL as idempotent `CREATE TABLE IF NOT EXISTS` (run via the write connection, or by hand
   in Trino UI for the first cut). Keep DDL text in `server/src/lakehouse/segment-membership-ddl.sql`
   (or inline constant) so it's version-tracked.
3. Smoke test: insert 1 synthetic row into each, `SELECT`, then `DELETE WHERE snapshot_date=...`
   to verify Iceberg row-level delete works (needed for idempotent re-runs in Phase 02).

## Related code files
- Create: `server/src/lakehouse/segment-membership-ddl.sql` (or a `lakehouse/` module)
- Read: `server/src/db/migrations/024-connectors.sql`, any existing Trino/presto client in `server/src`

## Success criteria
- Both tables exist in `stag_iceberg.khoitn`, queryable from Trino.
- App (or operator) can `INSERT`, `SELECT`, and partition-`DELETE` against them.
- Partition spec decided + recorded.

## Risks
- No existing app-side Trino write client → Phase 02 must add one (note for estimate).
- Iceberg connector lacking row-level delete → fall back to partition overwrite (`INSERT OVERWRITE`).

## Next
Phase 02 consumes these tables.
