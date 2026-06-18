/**
 * DDL for the lakehouse segment-snapshot tables, inlined as a TS constant so it
 * compiles into `dist` with the rest of the module.
 *
 * It used to live in a sibling `.sql` file read via readFileSync at runtime, but
 * `tsc` does not emit non-TS assets — so the prod image ENOENT'd on every snapshot
 * run unless a Dockerfile COPY remembered to stage it into dist. Inlining removes
 * that fragile build-step dependency entirely: there is nothing to copy.
 *
 * `ensureLakehouseTables()` replaces the `__LAKEHOUSE_TABLE_PREFIX__` token with
 * the env-scoped quoted `catalog."schema".` prefix, splits on `;`, and runs each
 * statement. CREATE TABLE IF NOT EXISTS keeps it idempotent.
 *
 * snapshot_ts: every snapshot row carries a `snapshot_ts TIMESTAMP` — the true
 * grain once segments capture at sub-daily cadence. The membership/delta/
 * definition tables were shipped without it, so they also get idempotent
 * `ALTER … ADD COLUMN IF NOT EXISTS snapshot_ts` statements (a CREATE IF NOT
 * EXISTS never alters an existing table). Pre-existing rows keep a NULL
 * snapshot_ts, read as the date's 00:00 bucket by consumers. Partitioning is
 * unchanged — snapshot_ts is a sort/filter column, NOT a partition key, so a
 * 15m segment stays one date partition (96 ts/day) rather than exploding to 96.
 *
 * The two new tables (member-state + kpi time-series) are appended here so the
 * single ensure-pass creates everything. The member-state column list is
 * GENERATED from CANONICAL_USER_STATE_COLUMNS so the schema can never drift from
 * the writer.
 */

import { STATE_VALUE_COLUMNS, sqlTypeFor } from './canonical-metric-set.js';

/** Placeholder replaced with the env-scoped quoted prefix at apply time. */
export const DDL_TABLE_PREFIX_TOKEN = '__LAKEHOUSE_TABLE_PREFIX__';

/** member-state value columns (canonical set minus uid), one per line, in the
 *  stable order the writer's INSERT also follows. */
const STATE_COLUMN_DDL = STATE_VALUE_COLUMNS.map(
  (c) => `  ${c.key} ${sqlTypeFor(c)}`,
).join(',\n');

export const SEGMENT_MEMBERSHIP_DDL = `
-- Full membership snapshot: one row per member, per segment, per snapshot.
-- Partitioned by (snapshot_date, game_id, segment_id) so a single cohort slice
-- prunes to one partition — the app targets 100s of segments per game and
-- point-by-segment reads dominate. Sorted by uid for compact per-partition files.
CREATE TABLE IF NOT EXISTS ${DDL_TABLE_PREFIX_TOKEN}segment_membership_daily (
  snapshot_date DATE,
  snapshot_ts   TIMESTAMP,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  uid           VARCHAR
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  sorted_by    = ARRAY['uid'],
  format       = 'PARQUET'
);

-- Additive snapshot_ts for tables shipped before sub-daily cadence existed.
ALTER TABLE ${DDL_TABLE_PREFIX_TOKEN}segment_membership_daily ADD COLUMN IF NOT EXISTS snapshot_ts TIMESTAMP;

-- Change feed (entered/exited) derived from consecutive per-segment snapshots.
-- Same partition grain so a single (day, game, segment) diff prunes cleanly.
CREATE TABLE IF NOT EXISTS ${DDL_TABLE_PREFIX_TOKEN}segment_membership_delta (
  snapshot_date DATE,
  snapshot_ts   TIMESTAMP,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  uid           VARCHAR,
  change        VARCHAR
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  sorted_by    = ARRAY['uid'],
  format       = 'PARQUET'
);

ALTER TABLE ${DDL_TABLE_PREFIX_TOKEN}segment_membership_delta ADD COLUMN IF NOT EXISTS snapshot_ts TIMESTAMP;

-- Definition snapshot: one row per eligible segment per snapshot, recording the
-- definition that PRODUCED that snapshot's membership. Segments are editable, so
-- without this the membership history can't distinguish "metric moved" from
-- "definition changed". Tiny table (dozens of rows/day) — partition by date only.
-- snapshot_cadence records the active capture cadence at snapshot time, so the
-- read API can derive cadence-change points without a separate history table.
CREATE TABLE IF NOT EXISTS ${DDL_TABLE_PREFIX_TOKEN}segment_definition_daily (
  snapshot_date       DATE,
  snapshot_ts         TIMESTAMP,
  game_id             VARCHAR,
  segment_id          VARCHAR,
  definition_hash     VARCHAR,
  name                VARCHAR,
  cube_name           VARCHAR,
  type                VARCHAR,
  identity_field      VARCHAR,
  predicate_tree_json VARCHAR,
  cube_query_json     VARCHAR,
  snapshot_cadence    VARCHAR
) WITH (
  partitioning = ARRAY['snapshot_date'],
  format       = 'PARQUET'
);

ALTER TABLE ${DDL_TABLE_PREFIX_TOKEN}segment_definition_daily ADD COLUMN IF NOT EXISTS snapshot_ts TIMESTAMP;
ALTER TABLE ${DDL_TABLE_PREFIX_TOKEN}segment_definition_daily ADD COLUMN IF NOT EXISTS snapshot_cadence VARCHAR;

-- Per-user canonical STATE snapshot: one row per (snapshot_ts, game, segment,
-- uid) carrying the canonical mf_users per-user dimensions. Keyed PER SEGMENT
-- (a uid in N segments → N rows/snapshot) because capture cadence is per-segment
-- — a global per-uid dedup would be ambiguous when a uid sits in a daily and a
-- 1h segment. Partition by (date, game, segment); snapshot_ts sorts within the
-- partition so a 15m segment is 96 ts in ONE date partition, not 96 partitions.
-- Columns after uid are generated from CANONICAL_USER_STATE_COLUMNS.
CREATE TABLE IF NOT EXISTS ${DDL_TABLE_PREFIX_TOKEN}segment_member_state_daily (
  snapshot_date DATE,
  snapshot_ts   TIMESTAMP,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  uid           VARCHAR,
${STATE_COLUMN_DDL}
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  sorted_by    = ARRAY['snapshot_ts', 'uid'],
  format       = 'PARQUET'
);

-- Segment KPI time-series (TALL): one row per (snapshot_ts, game, segment,
-- metric). Tall shape means adding/removing a KPI never changes the schema.
-- value is NULL when the KPI query returned no row (empty cohort) — the row is
-- still present. member_count carries the cohort size at that snapshot.
CREATE TABLE IF NOT EXISTS ${DDL_TABLE_PREFIX_TOKEN}segment_kpi_daily (
  snapshot_date DATE,
  snapshot_ts   TIMESTAMP,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  metric_id     VARCHAR,
  metric_label  VARCHAR,
  value         DOUBLE,
  member_count  BIGINT
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  format       = 'PARQUET'
);
`;
