/**
 * Delta computation: per-segment entered/exited change feed.
 *
 * Two modes:
 *  - Date-level (legacy): diff all segments on date D against D-1. One
 *    statement per date, run after the daily full-cohort pass.
 *  - Snapshot-ts-level (per-segment): diff a segment's snapshot at `snapshotTs`
 *    against its immediately prior snapshot (max snapshot_ts < current). Correct
 *    across cadence changes — the "previous" is always the actual last capture
 *    for that segment, not a fixed date offset. If no prior snapshot exists,
 *    every member is 'entered' (first observation for the segment).
 *
 * The snapshot stays the source of truth; the delta is a derived convenience.
 */

import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';
import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_SCHEMA,
  SEGMENT_MEMBERSHIP_DAILY,
  SEGMENT_MEMBERSHIP_DELTA,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from './lakehouse-trino-connector.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export interface DeltaWriteResult {
  snapshotDate: string;
  status: 'written' | 'error';
  /** Total change rows (entered + exited) landed. */
  rowCount?: number;
  error?: string;
}

export interface SegmentDeltaWriteResult {
  segmentId: string;
  snapshotTs: string;
  status: 'written' | 'error';
  rowCount?: number;
  error?: string;
}

/**
 * Compute the entered/exited delta for ONE (segment, snapshotTs) against
 * that segment's maximum prior snapshot_ts. Idempotent: deletes the
 * (game, segment, snapshot_ts) slice then inserts fresh. If no prior
 * snapshot exists all members of the current snapshot are 'entered'.
 *
 * Never throws — returns a structured result so the job can continue to
 * the next segment on failure.
 */
export async function writeSegmentMembershipDeltaForSegment(
  gameId: string,
  segmentId: string,
  snapshotDate: string,
  snapshotTs: string,
  opts: { connector?: Connector } = {},
): Promise<SegmentDeltaWriteResult> {
  const base = { segmentId, snapshotTs };
  if (!TS_RE.test(snapshotTs)) {
    return { ...base, status: 'error', error: `invalid snapshotTs: ${snapshotTs}` };
  }
  if (!DATE_RE.test(snapshotDate)) {
    return { ...base, status: 'error', error: `invalid snapshotDate: ${snapshotDate}` };
  }

  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const dateLit = `DATE '${snapshotDate}'`;
  const tsLit = `TIMESTAMP '${snapshotTs}'`;

  try {
    // Idempotent slice delete keyed on (snapshot_ts, game, segment).
    const deleteSql =
      `DELETE FROM ${SEGMENT_MEMBERSHIP_DELTA} ` +
      `WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND snapshot_ts = ${tsLit}`;

    // Subquery `prev_ts` resolves the immediately prior snapshot for this
    // segment — the max snapshot_ts strictly before the current one. Joining
    // to the previous membership at that exact ts handles cadence gaps (e.g.
    // a segment skipped yesterday). When prev_ts is NULL the FULL OUTER JOIN
    // on `p` naturally yields no rows, making every member of `d` 'entered'.
    const insertSql =
      // Explicit column list: snapshot_ts was ADDed to this table after it
      // shipped, so its physical position differs across environments (appended
      // last on already-created tables, declared earlier on fresh creates). A
      // positional INSERT would bind columns by physical order and mismatch.
      `INSERT INTO ${SEGMENT_MEMBERSHIP_DELTA} (snapshot_date, snapshot_ts, game_id, segment_id, uid, change)\n` +
      `WITH prev_ts AS (\n` +
      `  SELECT max(snapshot_ts) AS ts\n` +
      `  FROM ${SEGMENT_MEMBERSHIP_DAILY}\n` +
      `  WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
      `    AND snapshot_ts < ${tsLit}\n` +
      `),\n` +
      `d AS (\n` +
      `  SELECT uid FROM ${SEGMENT_MEMBERSHIP_DAILY}\n` +
      `  WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
      `    AND snapshot_ts = ${tsLit}\n` +
      `),\n` +
      `p AS (\n` +
      `  SELECT m.uid FROM ${SEGMENT_MEMBERSHIP_DAILY} m\n` +
      `  CROSS JOIN prev_ts\n` +
      `  WHERE m.game_id = ${gameLit} AND m.segment_id = ${segLit}\n` +
      `    AND prev_ts.ts IS NOT NULL\n` +
      `    AND m.snapshot_ts = prev_ts.ts\n` +
      `)\n` +
      `SELECT ${dateLit} AS snapshot_date,\n` +
      `       ${tsLit} AS snapshot_ts,\n` +
      `       ${gameLit} AS game_id,\n` +
      `       ${segLit} AS segment_id,\n` +
      `       COALESCE(d.uid, p.uid) AS uid,\n` +
      `       CASE WHEN p.uid IS NULL THEN 'entered' ELSE 'exited' END AS change\n` +
      `FROM d FULL OUTER JOIN p ON d.uid = p.uid\n` +
      `WHERE d.uid IS NULL OR p.uid IS NULL`;

    await runQuery(connector, LAKEHOUSE_SCHEMA, deleteSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
    await runQuery(connector, LAKEHOUSE_SCHEMA, insertSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);

    const countRes = await runQuery(
      connector,
      LAKEHOUSE_SCHEMA,
      `SELECT count(*) FROM ${SEGMENT_MEMBERSHIP_DELTA} WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND snapshot_ts = ${tsLit}`,
      LAKEHOUSE_STATEMENT_TIMEOUT_MS,
    );
    return { ...base, status: 'written', rowCount: Number(countRes.rows[0]?.[0] ?? 0) };
  } catch (err) {
    return { ...base, status: 'error', error: (err as Error).message };
  }
}

/**
 * Legacy date-level delta: diff all segments on date D against D-1.
 * Retained for backward compatibility — new per-cadence job uses
 * writeSegmentMembershipDeltaForSegment instead.
 */
export async function writeSegmentMembershipDelta(
  snapshotDate: string,
  opts: { connector?: Connector } = {},
): Promise<DeltaWriteResult> {
  if (!DATE_RE.test(snapshotDate)) {
    return { snapshotDate, status: 'error', error: `invalid snapshotDate: ${snapshotDate}` };
  }
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const dateLit = `DATE '${snapshotDate}'`;
  const prevLit = `${dateLit} - INTERVAL '1' DAY`;

  try {
    const deleteSql = `DELETE FROM ${SEGMENT_MEMBERSHIP_DELTA} WHERE snapshot_date = ${dateLit}`;
    // today_segs bounds both sides to segments observed on D, so a segment
    // absent from D's snapshot is neither entered nor exited (no observation).
    const insertSql =
      // Explicit column list (snapshot_ts omitted → NULL): the table now carries
      // snapshot_ts, so a positional INSERT of these 5 columns would mismatch.
      `INSERT INTO ${SEGMENT_MEMBERSHIP_DELTA} (snapshot_date, game_id, segment_id, uid, change)\n` +
      `WITH today_segs AS (\n` +
      `  SELECT DISTINCT game_id, segment_id FROM ${SEGMENT_MEMBERSHIP_DAILY} WHERE snapshot_date = ${dateLit}\n` +
      `),\n` +
      `d AS (\n` +
      `  SELECT game_id, segment_id, uid FROM ${SEGMENT_MEMBERSHIP_DAILY} WHERE snapshot_date = ${dateLit}\n` +
      `),\n` +
      `p AS (\n` +
      `  SELECT pr.game_id, pr.segment_id, pr.uid\n` +
      `  FROM ${SEGMENT_MEMBERSHIP_DAILY} pr\n` +
      `  JOIN today_segs t ON pr.game_id = t.game_id AND pr.segment_id = t.segment_id\n` +
      `  WHERE pr.snapshot_date = ${prevLit}\n` +
      `)\n` +
      `SELECT ${dateLit} AS snapshot_date,\n` +
      `       COALESCE(d.game_id, p.game_id) AS game_id,\n` +
      `       COALESCE(d.segment_id, p.segment_id) AS segment_id,\n` +
      `       COALESCE(d.uid, p.uid) AS uid,\n` +
      `       CASE WHEN p.uid IS NULL THEN 'entered' ELSE 'exited' END AS change\n` +
      `FROM d FULL OUTER JOIN p\n` +
      `  ON d.game_id = p.game_id AND d.segment_id = p.segment_id AND d.uid = p.uid\n` +
      `WHERE d.uid IS NULL OR p.uid IS NULL`;

    await runQuery(connector, LAKEHOUSE_SCHEMA, deleteSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
    await runQuery(connector, LAKEHOUSE_SCHEMA, insertSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);

    const countRes = await runQuery(
      connector,
      LAKEHOUSE_SCHEMA,
      `SELECT count(*) FROM ${SEGMENT_MEMBERSHIP_DELTA} WHERE snapshot_date = ${dateLit}`,
      LAKEHOUSE_STATEMENT_TIMEOUT_MS,
    );
    return { snapshotDate, status: 'written', rowCount: Number(countRes.rows[0]?.[0] ?? 0) };
  } catch (err) {
    return { snapshotDate, status: 'error', error: (err as Error).message };
  }
}
