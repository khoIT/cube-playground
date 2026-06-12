/**
 * Read-side of the lakehouse membership snapshot: per-day cohort size and
 * entered/exited counts for one segment, straight off
 * stag_iceberg.khoitn.segment_membership_daily / _delta.
 *
 * Both reads are single-partition-pruned aggregates (filtered by game_id +
 * segment_id + date range) — cheap even on cold Trino, but still capped with a
 * tighter timeout than the writers (reads back a few hundred rows max).
 */

import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';
import {
  lakehouseConnectorFromEnv,
  SEGMENT_MEMBERSHIP_DAILY,
  SEGMENT_MEMBERSHIP_DELTA,
  LAKEHOUSE_SCHEMA,
} from './lakehouse-trino-connector.js';

/** Reads return ~rows-per-day, not cohorts — 20s is generous for cold Trino. */
export const TRAJECTORY_READ_TIMEOUT_MS = 20_000;

export const MIN_TRAJECTORY_DAYS = 7;
export const MAX_TRAJECTORY_DAYS = 180;

export interface SizePoint {
  date: string;
  members: number;
}

export interface DeltaPoint {
  date: string;
  entered: number;
  exited: number;
}

export interface TrajectoryReadOptions {
  /** Injectable for tests; defaults to the env-derived lakehouse connector. */
  connector?: Connector;
}

export function clampTrajectoryDays(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return 90;
  return Math.max(MIN_TRAJECTORY_DAYS, Math.min(MAX_TRAJECTORY_DAYS, Math.trunc(n)));
}

/** Cohort size per snapshot day over the trailing `days` window. */
export async function readSizeSeries(
  gameId: string,
  segmentId: string,
  days: number,
  opts: TrajectoryReadOptions = {},
): Promise<SizePoint[]> {
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const sql =
    `SELECT CAST(snapshot_date AS varchar) AS d, count(*) AS members ` +
    `FROM ${SEGMENT_MEMBERSHIP_DAILY} ` +
    `WHERE game_id = ${toSqlLiteral(gameId)} AND segment_id = ${toSqlLiteral(segmentId)} ` +
    `AND snapshot_date >= date_add('day', -${Math.trunc(days)}, current_date) ` +
    `GROUP BY 1 ORDER BY 1`;
  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, TRAJECTORY_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({ date: String(r[0]), members: Number(r[1]) }));
}

/** Entered/exited counts per day over the trailing `days` window. */
export async function readDeltaSeries(
  gameId: string,
  segmentId: string,
  days: number,
  opts: TrajectoryReadOptions = {},
): Promise<DeltaPoint[]> {
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const sql =
    `SELECT CAST(snapshot_date AS varchar) AS d, ` +
    `sum(CASE WHEN change = 'entered' THEN 1 ELSE 0 END) AS entered, ` +
    `sum(CASE WHEN change = 'exited' THEN 1 ELSE 0 END) AS exited ` +
    `FROM ${SEGMENT_MEMBERSHIP_DELTA} ` +
    `WHERE game_id = ${toSqlLiteral(gameId)} AND segment_id = ${toSqlLiteral(segmentId)} ` +
    `AND snapshot_date >= date_add('day', -${Math.trunc(days)}, current_date) ` +
    `GROUP BY 1 ORDER BY 1`;
  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, TRAJECTORY_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({
    date: String(r[0]),
    entered: Number(r[1]),
    exited: Number(r[2]),
  }));
}
