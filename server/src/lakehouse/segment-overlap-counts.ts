/**
 * Set-math over the nightly membership snapshot for two segments.
 *
 * Two segments' latest-partition uid sets are intersected directly in Trino —
 * one statement returns A-size, B-size, the overlap, and each side's snapshot
 * timestamp. No uids are shipped to the app for the counts path; only the
 * save-region path materializes a region's uid list (and that, too, is computed
 * server-side, never round-tripped through the browser).
 *
 * "Latest partition" per segment = the rows at its newest snapshot_date, and
 * within that date the newest snapshot_ts (sub-daily cadence). Legacy rows have
 * a NULL snapshot_ts and read as that date's single daily bucket — when every
 * row of the latest date is NULL-ts we take them all; when a real ts exists we
 * take only the newest ts. DISTINCT uid collapses any duplicate identity rows.
 */

import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';
import { SEGMENT_MEMBERSHIP_DAILY } from './lakehouse-trino-connector.js';

export type OverlapRegion = 'aOnly' | 'both' | 'bOnly';

export interface OverlapCounts {
  aSize: number;
  bSize: number;
  aOnly: number;
  both: number;
  bOnly: number;
  /** |A∩B| / |A∪B|; 0 when both cohorts are empty. */
  jaccard: number;
  /** Newest snapshot_date for each segment (YYYY-MM-DD), or null if no partition. */
  aSnapshotDate: string | null;
  bSnapshotDate: string | null;
  /** Newest snapshot_ts for each segment (ISO-ish from Trino), or null. */
  aSnapshotTs: string | null;
  bSnapshotTs: string | null;
}

/**
 * Shared CTE prefix resolving each segment's latest-partition member set as
 * `a_members(uid)` / `b_members(uid)`. The counts query and the region-uids
 * query both append their own tail to this — defined once so the set-resolution
 * logic can never drift between the two reads.
 */
export function overlapCtePrefix(opts: {
  gameId: string;
  aSegId: string;
  bSegId: string;
}): string {
  const game = toSqlLiteral(opts.gameId);
  const a = toSqlLiteral(opts.aSegId);
  const b = toSqlLiteral(opts.bSegId);
  return (
    `WITH scoped AS (\n` +
    `  SELECT segment_id, uid, snapshot_date, snapshot_ts\n` +
    `  FROM ${SEGMENT_MEMBERSHIP_DAILY}\n` +
    `  WHERE game_id = ${game} AND segment_id IN (${a}, ${b})\n` +
    `),\n` +
    `maxdate AS (SELECT segment_id, max(snapshot_date) AS d FROM scoped GROUP BY segment_id),\n` +
    `latest_date AS (\n` +
    `  SELECT s.segment_id, s.uid, s.snapshot_date, s.snapshot_ts\n` +
    `  FROM scoped s JOIN maxdate m ON s.segment_id = m.segment_id AND s.snapshot_date = m.d\n` +
    `),\n` +
    `maxts AS (SELECT segment_id, max(snapshot_ts) AS ts FROM latest_date GROUP BY segment_id),\n` +
    `members AS (\n` +
    `  SELECT DISTINCT l.segment_id, l.uid, l.snapshot_date, l.snapshot_ts\n` +
    `  FROM latest_date l JOIN maxts x ON l.segment_id = x.segment_id\n` +
    `  WHERE x.ts IS NULL OR l.snapshot_ts = x.ts\n` +
    `),\n` +
    `a_members AS (SELECT uid FROM members WHERE segment_id = ${a}),\n` +
    `b_members AS (SELECT uid FROM members WHERE segment_id = ${b})`
  );
}

/** One statement returning the three region counts + sizes + snapshot stamps. */
export function buildOverlapCountsSql(opts: {
  gameId: string;
  aSegId: string;
  bSegId: string;
}): string {
  const a = toSqlLiteral(opts.aSegId);
  const b = toSqlLiteral(opts.bSegId);
  return (
    `${overlapCtePrefix(opts)}\n` +
    `SELECT\n` +
    `  (SELECT count(*) FROM a_members) AS a_size,\n` +
    `  (SELECT count(*) FROM b_members) AS b_size,\n` +
    `  (SELECT count(*) FROM a_members WHERE uid IN (SELECT uid FROM b_members)) AS both_count,\n` +
    `  (SELECT max(snapshot_date) FROM members WHERE segment_id = ${a}) AS a_date,\n` +
    `  (SELECT max(snapshot_date) FROM members WHERE segment_id = ${b}) AS b_date,\n` +
    `  (SELECT max(snapshot_ts) FROM members WHERE segment_id = ${a}) AS a_ts,\n` +
    `  (SELECT max(snapshot_ts) FROM members WHERE segment_id = ${b}) AS b_ts`
  );
}

/** Region uid list (deduped) for save-as-segment. Set operators are null-safe. */
export function buildRegionUidsSql(opts: {
  gameId: string;
  aSegId: string;
  bSegId: string;
  region: OverlapRegion;
}): string {
  const tail =
    opts.region === 'aOnly'
      ? `SELECT uid FROM a_members EXCEPT SELECT uid FROM b_members`
      : opts.region === 'bOnly'
        ? `SELECT uid FROM b_members EXCEPT SELECT uid FROM a_members`
        : `SELECT uid FROM a_members INTERSECT SELECT uid FROM b_members`;
  return `${overlapCtePrefix(opts)}\n${tail}`;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

/** Run the counts statement and shape the result (derives onlys + Jaccard). */
export async function computeSegmentOverlap(
  connector: Connector,
  schema: string,
  opts: { gameId: string; aSegId: string; bSegId: string },
  timeoutMs?: number,
): Promise<OverlapCounts> {
  const sql = buildOverlapCountsSql(opts);
  const res = await runQuery(connector, schema, sql, timeoutMs);
  const row = res.rows[0] ?? [];
  const aSize = num(row[0]);
  const bSize = num(row[1]);
  const both = num(row[2]);
  const union = aSize + bSize - both;
  return {
    aSize,
    bSize,
    both,
    aOnly: Math.max(0, aSize - both),
    bOnly: Math.max(0, bSize - both),
    jaccard: union > 0 ? both / union : 0,
    aSnapshotDate: str(row[3]),
    bSnapshotDate: str(row[4]),
    aSnapshotTs: str(row[5]),
    bSnapshotTs: str(row[6]),
  };
}

/** Run the region statement and return the deduped uid list. */
export async function fetchRegionUids(
  connector: Connector,
  schema: string,
  opts: { gameId: string; aSegId: string; bSegId: string; region: OverlapRegion },
  timeoutMs?: number,
): Promise<string[]> {
  const sql = buildRegionUidsSql(opts);
  const res = await runQuery(connector, schema, sql, timeoutMs);
  return res.rows.map((r) => String(r[0])).filter((u) => u.length > 0);
}
