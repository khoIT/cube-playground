/**
 * Read-side for the segment movement / KPI trend / state-distribution APIs.
 *
 * All queries are bounded (date-range cap), single-partition-pruned by
 * (game_id, segment_id, snapshot_date), and served stale on Trino error via
 * the in-memory TTL cache the route layer manages. Params flow through
 * toSqlLiteral so no string interpolation reaches Trino.
 *
 * Mirrors the posture of segment-trajectory-reader: short env-tunable timeout,
 * no Trino retries (let the route serve stale), structured result types.
 */

import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';
import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_SCHEMA,
  SEGMENT_KPI_DAILY,
  SEGMENT_MEMBERSHIP_DELTA,
  SEGMENT_MEMBER_STATE_DAILY,
  SEGMENT_DEFINITION_DAILY,
} from './lakehouse-trino-connector.js';
import type { SnapshotCadence } from './downsample-snapshots.js';

/** Strict ISO-8601 timestamp regex — guards against SQL injection via the `ts` param.
 *  Accepts "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS" (Trino TIMESTAMP literal format). */
export const SNAPSHOT_TS_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

/** Strict ISO-8601 date regex — guards against SQL injection via `from`/`to` params. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Defense-in-depth: assert a date range is safe before interpolating into SQL.
 *  The route already validates via DATE_RE → 400; this is a second backstop. */
function assertDateRange(fromDate: string, toDate: string, fn: string): void {
  if (!DATE_RE.test(fromDate)) {
    throw new Error(`${fn}: invalid fromDate format: ${fromDate}`);
  }
  if (!DATE_RE.test(toDate)) {
    throw new Error(`${fn}: invalid toDate format: ${toDate}`);
  }
}

/** Env-tunable read timeout. Sized to outlast a cold warehouse aggregate. */
export const MOVEMENT_READ_TIMEOUT_MS =
  Number(process.env.SEGMENT_MOVEMENT_TIMEOUT_MS) || 120_000;

/** Maximum window for daily-granularity reads (180 days × 1 point/day ≈ 180 rows). */
export const MAX_DAILY_DAYS = 180;
/** Maximum window for 15m-granularity reads (14d × 96 ticks/day ≈ 1344 rows). */
export const MAX_SUBDAILY_DAYS = 14;

export interface MovementReaderOptions {
  connector?: Connector;
}

export interface KpiTrendRow {
  ts: string;
  metricId: string;
  value: number | null;
  memberCount: number;
}

export interface MovementRow {
  ts: string;
  entered: number;
  exited: number;
  memberCount: number | null;
}

export interface StateDistributionRow {
  dimension: string;
  count: number;
}

export interface StateDistributionTrendRow {
  ts: string;
  dimension: string;
  count: number;
}

export interface CadenceDefRow {
  ts: string;
  cadence: string | null;
}

/** One captured snapshot for the per-segment ledger: cohort size + how many
 *  distinct KPIs were recorded at that snapshot_ts. Counts only — no identities. */
export interface SnapshotLedgerRow {
  ts: string;
  memberCount: number;
  kpiCount: number;
}

/** A distinct (segment_id, snapshot_ts) pair for the fleet coverage aggregate. */
export interface FleetCoverageTsRow {
  segmentId: string;
  ts: string;
}

/** Clamp `days` to a safe range based on whether the request is sub-daily.
 *  Non-finite / non-numeric input returns the default (7 subdaily, 30 daily).
 *  Numeric input below 1 is clamped to 1 (caller provided a value, even if tiny). */
export function clampMovementDays(raw: unknown, subdaily = false): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  const max = subdaily ? MAX_SUBDAILY_DAYS : MAX_DAILY_DAYS;
  if (!Number.isFinite(n)) return subdaily ? 7 : 30;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

/**
 * Fetch raw KPI-trend rows for a segment over a date range.
 * When `metrics` is provided, filters to those metric_ids only.
 */
export async function readKpiTrend(
  gameId: string,
  segmentId: string,
  fromDate: string,
  toDate: string,
  opts: MovementReaderOptions & { metrics?: string[] } = {},
): Promise<KpiTrendRow[]> {
  assertDateRange(fromDate, toDate, 'readKpiTrend');
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const fromLit = `DATE '${fromDate}'`;
  const toLit = `DATE '${toDate}'`;

  const metricClause =
    opts.metrics && opts.metrics.length > 0
      ? ` AND metric_id IN (${opts.metrics.map(toSqlLiteral).join(', ')})`
      : '';

  const sql =
    `SELECT CAST(snapshot_ts AS VARCHAR) AS ts, metric_id, value, member_count ` +
    `FROM ${SEGMENT_KPI_DAILY} ` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit} ` +
    `  AND snapshot_date BETWEEN ${fromLit} AND ${toLit}` +
    metricClause +
    ` ORDER BY snapshot_ts, metric_id`;

  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, MOVEMENT_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({
    ts: String(r[0]).replace('T', ' ').slice(0, 19),
    metricId: String(r[1]),
    value: r[2] == null ? null : Number(r[2]),
    memberCount: Number(r[3] ?? 0),
  }));
}

/**
 * Fetch entered/exited rows per snapshot_ts, with member_count joined from
 * the KPI table (member_count is the most reliable source for cohort size at ts).
 */
export async function readMovementSeries(
  gameId: string,
  segmentId: string,
  fromDate: string,
  toDate: string,
  opts: MovementReaderOptions = {},
): Promise<MovementRow[]> {
  assertDateRange(fromDate, toDate, 'readMovementSeries');
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const fromLit = `DATE '${fromDate}'`;
  const toLit = `DATE '${toDate}'`;

  // Aggregate delta by (snapshot_ts, change), then pivot to entered/exited columns.
  // LEFT JOIN to kpi_daily to pick up member_count at that ts.
  const sql =
    `WITH delta_agg AS (\n` +
    `  SELECT CAST(snapshot_ts AS VARCHAR) AS ts,\n` +
    `         SUM(CASE WHEN change = 'entered' THEN 1 ELSE 0 END) AS entered,\n` +
    `         SUM(CASE WHEN change = 'exited'  THEN 1 ELSE 0 END) AS exited\n` +
    `  FROM ${SEGMENT_MEMBERSHIP_DELTA}\n` +
    `  WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
    `    AND snapshot_date BETWEEN ${fromLit} AND ${toLit}\n` +
    `  GROUP BY 1\n` +
    `),\n` +
    `kpi_mc AS (\n` +
    `  SELECT CAST(snapshot_ts AS VARCHAR) AS ts, MAX(member_count) AS member_count\n` +
    `  FROM ${SEGMENT_KPI_DAILY}\n` +
    `  WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
    `    AND snapshot_date BETWEEN ${fromLit} AND ${toLit}\n` +
    `  GROUP BY 1\n` +
    `)\n` +
    `SELECT d.ts, d.entered, d.exited, k.member_count\n` +
    `FROM delta_agg d LEFT JOIN kpi_mc k ON d.ts = k.ts\n` +
    `ORDER BY d.ts`;

  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, MOVEMENT_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({
    ts: String(r[0]).replace('T', ' ').slice(0, 19),
    entered: Number(r[1] ?? 0),
    exited: Number(r[2] ?? 0),
    memberCount: r[3] == null ? null : Number(r[3]),
  }));
}

/**
 * Fetch the state-distribution (bucket counts) for one segment at a single
 * snapshot_ts. Joins membership to member_state on uid.
 */
export async function readStateDistribution(
  gameId: string,
  segmentId: string,
  snapshotTs: string,
  dimension: string,
  opts: MovementReaderOptions = {},
): Promise<StateDistributionRow[]> {
  const connector = opts.connector ?? lakehouseConnectorFromEnv();

  // Defense-in-depth: assert snapshotTs matches the strict regex even though
  // the route layer already validates via SNAPSHOT_TS_RE → 400.
  if (!SNAPSHOT_TS_RE.test(snapshotTs)) {
    throw new Error(`readStateDistribution: invalid snapshotTs format: ${snapshotTs}`);
  }

  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const tsLit = `TIMESTAMP '${snapshotTs}'`;

  // dimension is validated by the route layer (allow-list); cast to VARCHAR so
  // unknown enum values don't cause type errors, and group NULL as '__unknown__'.
  const sql =
    `SELECT COALESCE(CAST(${dimension} AS VARCHAR), '__unknown__') AS dim_val, COUNT(*) AS cnt\n` +
    `FROM ${SEGMENT_MEMBER_STATE_DAILY}\n` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND snapshot_ts = ${tsLit}\n` +
    `GROUP BY 1 ORDER BY 2 DESC`;

  // Note: `dimension` is validated against the allow-list in the route before
  // reaching here — it must be a known canonical key, not arbitrary user input.
  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, MOVEMENT_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({
    dimension: String(r[0]),
    count: Number(r[1]),
  }));
}

/**
 * Fetch the state-distribution trend over a date range: per (snapshot_ts, dimension_value).
 */
export async function readStateDistributionTrend(
  gameId: string,
  segmentId: string,
  fromDate: string,
  toDate: string,
  dimension: string,
  opts: MovementReaderOptions = {},
): Promise<StateDistributionTrendRow[]> {
  assertDateRange(fromDate, toDate, 'readStateDistributionTrend');
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const fromLit = `DATE '${fromDate}'`;
  const toLit = `DATE '${toDate}'`;

  const sql =
    `SELECT CAST(snapshot_ts AS VARCHAR) AS ts,\n` +
    `       COALESCE(CAST(${dimension} AS VARCHAR), '__unknown__') AS dim_val,\n` +
    `       COUNT(*) AS cnt\n` +
    `FROM ${SEGMENT_MEMBER_STATE_DAILY}\n` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
    `  AND snapshot_date BETWEEN ${fromLit} AND ${toLit}\n` +
    `GROUP BY 1, 2 ORDER BY 1, 3 DESC`;

  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, MOVEMENT_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({
    ts: String(r[0]).replace('T', ' ').slice(0, 19),
    dimension: String(r[1]),
    count: Number(r[2]),
  }));
}

/**
 * Distinct captured snapshot_ts for a segment over a window, read from the KPI
 * table — the authoritative per-snapshot record (every snapshot writes a KPI
 * row per metric, NULL-valued on empty cohort, so no capture is missed). This
 * is the honest source for the capture-coverage strip's per-era timeline: it
 * spans the full history, unlike the definition table (which only began being
 * written when per-segment cadence shipped, so it omits older daily snapshots).
 * Returns ts strings ordered ascending.
 */
export async function readCaptureTimestamps(
  gameId: string,
  segmentId: string,
  fromDate: string,
  toDate: string,
  opts: MovementReaderOptions = {},
): Promise<string[]> {
  assertDateRange(fromDate, toDate, 'readCaptureTimestamps');
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const fromLit = `DATE '${fromDate}'`;
  const toLit = `DATE '${toDate}'`;

  const sql =
    `SELECT DISTINCT CAST(snapshot_ts AS VARCHAR) AS ts\n` +
    `FROM ${SEGMENT_KPI_DAILY}\n` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
    `  AND snapshot_date BETWEEN ${fromLit} AND ${toLit}\n` +
    `  AND snapshot_ts IS NOT NULL\n` +
    `ORDER BY ts`;

  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, MOVEMENT_READ_TIMEOUT_MS);
  return res.rows.map((r) => String(r[0]).replace('T', ' ').slice(0, 19));
}

/**
 * Per-snapshot ledger for one segment over a window: one row per captured
 * snapshot_ts with the cohort size (MAX member_count across that ts's metric
 * rows) and the count of distinct KPIs recorded. Reads the KPI table — the
 * authoritative per-snapshot record (every snapshot writes a row per metric).
 * Ordered newest-first so the UI lists most-recent captures at the top.
 */
export async function readSnapshotLedger(
  gameId: string,
  segmentId: string,
  fromDate: string,
  toDate: string,
  opts: MovementReaderOptions = {},
): Promise<SnapshotLedgerRow[]> {
  assertDateRange(fromDate, toDate, 'readSnapshotLedger');
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const fromLit = `DATE '${fromDate}'`;
  const toLit = `DATE '${toDate}'`;

  const sql =
    `SELECT CAST(snapshot_ts AS VARCHAR) AS ts,\n` +
    `       MAX(member_count) AS member_count,\n` +
    `       COUNT(DISTINCT metric_id) AS kpi_count\n` +
    `FROM ${SEGMENT_KPI_DAILY}\n` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
    `  AND snapshot_date BETWEEN ${fromLit} AND ${toLit}\n` +
    `  AND snapshot_ts IS NOT NULL\n` +
    `GROUP BY 1 ORDER BY ts DESC`;

  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, MOVEMENT_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({
    ts: String(r[0]).replace('T', ' ').slice(0, 19),
    memberCount: Number(r[1] ?? 0),
    kpiCount: Number(r[2] ?? 0),
  }));
}

/**
 * Single-pass fleet aggregate: distinct (segment_id, snapshot_ts) pairs across
 * a set of (segmentId, gameId) scopes over a window. ONE Trino round-trip for
 * the whole fleet (no per-segment N+1); the route groups the result by segment
 * and derives eras / depth / last-snapshot in memory. Partition-pruned by both
 * the game_id set and the segment_id set. Returns [] for an empty scope list.
 */
export async function readSnapshotCoverageTimestamps(
  scopes: Array<{ segmentId: string; gameId: string }>,
  fromDate: string,
  toDate: string,
  opts: MovementReaderOptions = {},
): Promise<FleetCoverageTsRow[]> {
  assertDateRange(fromDate, toDate, 'readSnapshotCoverageTimestamps');
  if (scopes.length === 0) return [];
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const segIn = scopes.map((s) => toSqlLiteral(s.segmentId)).join(', ');
  const gameIn = [...new Set(scopes.map((s) => s.gameId))].map(toSqlLiteral).join(', ');
  const fromLit = `DATE '${fromDate}'`;
  const toLit = `DATE '${toDate}'`;

  const sql =
    `SELECT segment_id, CAST(snapshot_ts AS VARCHAR) AS ts\n` +
    `FROM ${SEGMENT_KPI_DAILY}\n` +
    `WHERE game_id IN (${gameIn}) AND segment_id IN (${segIn})\n` +
    `  AND snapshot_date BETWEEN ${fromLit} AND ${toLit}\n` +
    `  AND snapshot_ts IS NOT NULL\n` +
    `GROUP BY segment_id, CAST(snapshot_ts AS VARCHAR)`;

  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, MOVEMENT_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({
    segmentId: String(r[0]),
    ts: String(r[1]).replace('T', ' ').slice(0, 19),
  }));
}

/**
 * Fetch (snapshot_ts, snapshot_cadence) pairs from the definition table for
 * a segment over a date range. Used to derive effective_granularity and
 * cadence_changes. Returns rows ordered by ts ascending.
 */
export async function readCadenceHistory(
  gameId: string,
  segmentId: string,
  fromDate: string,
  toDate: string,
  opts: MovementReaderOptions = {},
): Promise<CadenceDefRow[]> {
  assertDateRange(fromDate, toDate, 'readCadenceHistory');
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const fromLit = `DATE '${fromDate}'`;
  const toLit = `DATE '${toDate}'`;

  const sql =
    `SELECT CAST(snapshot_ts AS VARCHAR) AS ts, snapshot_cadence\n` +
    `FROM ${SEGMENT_DEFINITION_DAILY}\n` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit}\n` +
    `  AND snapshot_date BETWEEN ${fromLit} AND ${toLit}\n` +
    `  AND snapshot_ts IS NOT NULL\n` +
    `ORDER BY snapshot_ts`;

  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, MOVEMENT_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({
    ts: String(r[0]).replace('T', ' ').slice(0, 19),
    cadence: r[1] == null ? null : String(r[1]),
  }));
}
