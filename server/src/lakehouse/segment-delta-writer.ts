/**
 * Phase: delta computation (D vs D-1).
 *
 * After date D's full snapshots land, derive the entered/exited change feed by
 * diffing D against D-1 per (game_id, segment_id), writing to
 * segment_membership_delta. The daily snapshot stays the source of truth; the
 * delta is a downstream convenience derived from it.
 *
 * Runs once per date over ALL segments snapshotted that day (set-based, cheap)
 * — the diff is scoped to (game, segment) pairs present in D's snapshot, so a
 * segment that FAILED to snapshot today produces no spurious 'exited' rows
 * (we have no observation for it, so we emit no change).
 */

import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_SCHEMA,
  SEGMENT_MEMBERSHIP_DAILY,
  SEGMENT_MEMBERSHIP_DELTA,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from './lakehouse-trino-connector.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DeltaWriteResult {
  snapshotDate: string;
  status: 'written' | 'error';
  /** Total change rows (entered + exited) landed for the date. */
  rowCount?: number;
  error?: string;
}

/**
 * Compute and write the day-over-day delta for `snapshotDate` (YYYY-MM-DD).
 * Idempotent: clears the date's delta slice first. If D-1 is missing (first
 * run / gap), every member of every D segment is 'entered' (the FULL OUTER
 * JOIN yields this because `p` is empty for those segments).
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
      `INSERT INTO ${SEGMENT_MEMBERSHIP_DELTA}\n` +
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
