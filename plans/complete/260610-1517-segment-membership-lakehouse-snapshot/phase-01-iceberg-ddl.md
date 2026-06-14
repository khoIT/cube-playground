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
Iceberg props: `partitioning = ARRAY['snapshot_date','game_id','segment_id']`,
`sorted_by = ARRAY['uid']`, `format = 'PARQUET'`.

### `stag_iceberg.khoitn.segment_membership_delta`
Day-over-day change feed for downstream consumers.
```
snapshot_date   DATE       -- date D at which the change is observed (vs D-1)
game_id         VARCHAR
segment_id      VARCHAR
uid             VARCHAR
change          VARCHAR     -- 'entered' | 'exited'
```
Partition `['snapshot_date','game_id','segment_id']`.

## Decision: partition grain (RESOLVED)
Partition by **`(snapshot_date, game_id, segment_id)`**, sort by `uid`. The app targets
100s of segments per game and point-by-segment reads dominate, so segment_id in the partition
spec gives direct pruning to a single cohort slice. Daily write per `(date,game,segment)` is
one partition → one file group, so small-file risk is bounded by the per-day-per-segment cohort,
not fragmented across the table.

## Implementation steps
1. Trino write connection (RESOLVED): creds live in **`cube-dev/.env`** — read host/port/user/
   password/catalog from there for the write client. No new provisioning. Capture how the app
   issues statements (no existing `trino`/`presto` client in `server/src` → Phase 02 adds one).
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
