/**
 * DDL for the lakehouse segment-membership snapshot tables, inlined as a TS
 * constant so it compiles into `dist` with the rest of the module.
 *
 * It used to live in a sibling `.sql` file read via readFileSync at runtime, but
 * `tsc` does not emit non-TS assets — so the prod image ENOENT'd on every snapshot
 * run unless a Dockerfile COPY remembered to stage it into dist. Inlining removes
 * that fragile build-step dependency entirely: there is nothing to copy.
 *
 * `ensureLakehouseTables()` replaces the `__LAKEHOUSE_TABLE_PREFIX__` token with
 * the env-scoped quoted `catalog."schema".` prefix, splits on `;`, and runs each
 * statement. CREATE TABLE IF NOT EXISTS keeps it idempotent.
 */

/** Placeholder replaced with the env-scoped quoted prefix at apply time. */
export const DDL_TABLE_PREFIX_TOKEN = '__LAKEHOUSE_TABLE_PREFIX__';

export const SEGMENT_MEMBERSHIP_DDL = `
-- Full membership snapshot: one row per member, per segment, per day.
-- Partitioned by (snapshot_date, game_id, segment_id) so a single cohort slice
-- prunes to one partition — the app targets 100s of segments per game and
-- point-by-segment reads dominate. Sorted by uid for compact per-partition files.
CREATE TABLE IF NOT EXISTS ${DDL_TABLE_PREFIX_TOKEN}segment_membership_daily (
  snapshot_date DATE,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  uid           VARCHAR
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  sorted_by    = ARRAY['uid'],
  format       = 'PARQUET'
);

-- Day-over-day change feed (entered/exited) derived from the daily snapshot.
-- Same partition grain so a single (day, game, segment) diff prunes cleanly.
CREATE TABLE IF NOT EXISTS ${DDL_TABLE_PREFIX_TOKEN}segment_membership_delta (
  snapshot_date DATE,
  game_id       VARCHAR,
  segment_id    VARCHAR,
  uid           VARCHAR,
  change        VARCHAR
) WITH (
  partitioning = ARRAY['snapshot_date', 'game_id', 'segment_id'],
  sorted_by    = ARRAY['uid'],
  format       = 'PARQUET'
);

-- Daily definition snapshot: one row per eligible segment per day, recording
-- the definition that PRODUCED that day's membership partition. Segments are
-- editable, so without this the membership history can't distinguish "metric
-- moved" from "definition changed". Change detection is derived, not stored:
--   definition_hash != lag(definition_hash) OVER (PARTITION BY segment_id
--                                                 ORDER BY snapshot_date)
-- Tiny table (dozens of rows/day) — partition by date only.
CREATE TABLE IF NOT EXISTS ${DDL_TABLE_PREFIX_TOKEN}segment_definition_daily (
  snapshot_date       DATE,
  game_id             VARCHAR,
  segment_id          VARCHAR,
  definition_hash     VARCHAR,
  name                VARCHAR,
  cube_name           VARCHAR,
  type                VARCHAR,
  identity_field      VARCHAR,
  predicate_tree_json VARCHAR,
  cube_query_json     VARCHAR
) WITH (
  partitioning = ARRAY['snapshot_date'],
  format       = 'PARQUET'
);
`;
