/**
 * Three-lens metric series over membership snapshots ⨝ per-user daily marts —
 * the JOIN side of "persist the non-recomputable, join the immutable". Server
 * Trino SQL deliberately, NOT a Cube model: entry/stayers are anchor-
 * parameterized self-intersections of the membership table that Cube cannot
 * express (two filter values on one cube).
 *
 *   current — membership@d ⨝ fact@d per day. Composition artifacts possible
 *             (a whale exiting moves the sum with no behavior change).
 *   entry   — closed cohort: everyone who ENTERED on/after the anchor, tracked
 *             through the marts forever, INCLUDING after they exit the
 *             segment. The experimentation-correct lens.
 *   stayers — membership@anchor ∩ membership@d. Survivor-biased by
 *             construction; consumers MUST label it.
 *
 * All literals via toSqlLiteral / validated date strings. Per-user-day mart
 * grain is probe-verified on live data, so the LEFT JOINs cannot fan out.
 */

import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';
import {
  lakehouseConnectorFromEnv,
  lakehouseSchemaForGame,
  SEGMENT_MEMBERSHIP_DAILY,
  SEGMENT_MEMBERSHIP_DELTA,
  LAKEHOUSE_SCHEMA,
} from './lakehouse-trino-connector.js';
import type { MetricBinding } from './segment-metric-registry.js';

export const METRIC_SERIES_TIMEOUT_MS = 30_000;
export const MAX_METRIC_SERIES_DAYS = 120;

export type MetricLens = 'current' | 'entry' | 'stayers';

export interface MetricSeriesPoint {
  date: string;
  value: number;
  /** Cohort size under the lens that day (current/stayers: snapshot count;
   *  entry: cumulative entered through that day). */
  memberCount: number;
}

export interface MetricSeriesResult {
  points: MetricSeriesPoint[];
  /** Set when every day joined zero mart rows despite a non-empty cohort —
   *  the identity-namespace-mismatch signature (sparse days alone don't trip it). */
  joinWarning: string | null;
}

export interface MetricSeriesRequest {
  gameId: string;
  segmentId: string;
  binding: MetricBinding;
  lens: MetricLens;
  /** Required for entry/stayers (route-validated). */
  anchor?: string;
  days: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidAnchor(anchor: unknown): anchor is string {
  if (typeof anchor !== 'string' || !DATE_RE.test(anchor)) return false;
  // Reject shape-valid but impossible dates (2026-13-45) here so they fail as
  // a 400 at the route instead of a Trino parse error misclassified as a 502.
  const d = new Date(`${anchor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === anchor;
}

export function clampMetricDays(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return 90;
  return Math.max(1, Math.min(MAX_METRIC_SERIES_DAYS, Math.trunc(n)));
}

function valueExpr(b: MetricBinding): string {
  return b.agg === 'sum'
    ? `coalesce(sum(f.${b.valueCol}), 0)`
    : `count(distinct f.${b.uidCol})`;
}

function factFqn(connector: Connector, gameId: string, mart: string): string {
  const schema = lakehouseSchemaForGame(gameId);
  if (!schema) throw new Error(`no Trino schema for game ${gameId}`);
  return `${connector.catalog ?? 'game_integration'}.${schema}.${mart}`;
}

/** Minimum cohort days before an all-zero join reads as a namespace mismatch
 *  rather than legitimate sparsity (live data: a 224-member jus segment had 0
 *  same-day payers across 2 snapshot days while the join itself was correct). */
const DEAD_JOIN_MIN_DAYS = 5;

function warnIfDeadJoin(points: MetricSeriesPoint[], joined: number[], req: MetricSeriesRequest): string | null {
  const cohortDays = points.filter((p) => p.memberCount > 0).length;
  if (cohortDays < DEAD_JOIN_MIN_DAYS || joined.some((j) => j > 0)) return null;
  const msg =
    `metric-series join matched 0 mart rows on all ${cohortDays} cohort days ` +
    `(${req.gameId}/${req.binding.mart}) — likely identity-namespace mismatch between ` +
    `membership uid and ${req.binding.uidCol}`;
  console.warn(`[segment-metric-series] ${msg}`);
  return msg;
}

export async function readMetricSeries(
  req: MetricSeriesRequest,
  opts: { connector?: Connector } = {},
): Promise<MetricSeriesResult> {
  const connector = opts.connector ?? lakehouseConnectorFromEnv();
  if (req.lens === 'current') return readCurrentLens(req, connector);
  if (!isValidAnchor(req.anchor)) throw new Error(`lens '${req.lens}' requires a valid anchor date`);
  return req.lens === 'entry' ? readEntryLens(req, connector) : readStayersLens(req, connector);
}

async function readCurrentLens(req: MetricSeriesRequest, connector: Connector): Promise<MetricSeriesResult> {
  const b = req.binding;
  const sql =
    `SELECT CAST(m.snapshot_date AS varchar) AS d, count(distinct m.uid) AS member_count, ` +
    `count(distinct f.${b.uidCol}) AS joined_members, ${valueExpr(b)} AS value ` +
    `FROM ${SEGMENT_MEMBERSHIP_DAILY} m ` +
    `LEFT JOIN ${factFqn(connector, req.gameId, b.mart)} f ` +
    `ON f.${b.uidCol} = m.uid AND f.${b.dateCol} = m.snapshot_date ` +
    `WHERE m.game_id = ${toSqlLiteral(req.gameId)} AND m.segment_id = ${toSqlLiteral(req.segmentId)} ` +
    `AND m.snapshot_date >= date_add('day', -${Math.trunc(req.days)}, current_date) ` +
    `GROUP BY 1 ORDER BY 1`;
  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, METRIC_SERIES_TIMEOUT_MS);
  const joined: number[] = [];
  const points = res.rows.map((r) => {
    joined.push(Number(r[2]));
    return { date: String(r[0]), memberCount: Number(r[1]), value: Number(r[3]) };
  });
  return { points, joinWarning: warnIfDeadJoin(points, joined, req) };
}

/** Entry lens needs two reads (serialized): fact series over the fixed cohort,
 *  plus per-day entry counts merged into a cumulative memberCount app-side. */
async function readEntryLens(req: MetricSeriesRequest, connector: Connector): Promise<MetricSeriesResult> {
  const b = req.binding;
  const anchorLit = `DATE '${req.anchor}'`;
  const gameLit = toSqlLiteral(req.gameId);
  const segLit = toSqlLiteral(req.segmentId);
  const endCap = `date_add('day', ${Math.trunc(req.days)}, ${anchorLit})`;

  // Per-member clock: each member's mart activity counts only from their OWN
  // first entry day, not from the anchor — otherwise a member entering day 20
  // would contribute days 1–19 of pre-entry activity to a lens labelled
  // causal, and joined_members could exceed the cumulative cohort size.
  const factSql =
    `WITH cohort AS (SELECT uid, min(snapshot_date) AS first_entry FROM ${SEGMENT_MEMBERSHIP_DELTA} ` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND change = 'entered' ` +
    `AND snapshot_date >= ${anchorLit} AND snapshot_date <= ${endCap} GROUP BY uid) ` +
    `SELECT CAST(f.${b.dateCol} AS varchar) AS d, count(distinct f.${b.uidCol}) AS joined_members, ` +
    `${valueExpr(b)} AS value ` +
    `FROM ${factFqn(connector, req.gameId, b.mart)} f ` +
    `JOIN cohort c ON f.${b.uidCol} = c.uid AND f.${b.dateCol} >= c.first_entry ` +
    `WHERE f.${b.dateCol} >= ${anchorLit} AND f.${b.dateCol} <= ${endCap} ` +
    `GROUP BY 1 ORDER BY 1`;
  const factRes = await runQuery(connector, LAKEHOUSE_SCHEMA, factSql, METRIC_SERIES_TIMEOUT_MS);

  // Group by each uid's FIRST entry day so re-"entered" rows (e.g. the full-
  // cohort delta artifact after a missed snapshot night) can't double-count a
  // member in the cumulative cohort size.
  const enteredSql =
    `SELECT CAST(first_entry AS varchar) AS d, count(*) AS entered FROM (` +
    `SELECT uid, min(snapshot_date) AS first_entry FROM ${SEGMENT_MEMBERSHIP_DELTA} ` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND change = 'entered' ` +
    `AND snapshot_date >= ${anchorLit} AND snapshot_date <= ${endCap} ` +
    `GROUP BY uid) GROUP BY 1 ORDER BY 1`;
  const enteredRes = await runQuery(connector, LAKEHOUSE_SCHEMA, enteredSql, METRIC_SERIES_TIMEOUT_MS);

  // Cumulative cohort size through each fact day (closed cohort grows only by
  // later entries; exits deliberately ignored — that's the lens's point).
  const entries = enteredRes.rows.map((r) => ({ date: String(r[0]), n: Number(r[1]) }));
  const joined: number[] = [];
  let cum = 0;
  let ei = 0;
  const points = factRes.rows.map((r) => {
    const date = String(r[0]);
    while (ei < entries.length && entries[ei].date <= date) cum += entries[ei++].n;
    joined.push(Number(r[1]));
    return { date, memberCount: cum, value: Number(r[2]) };
  });

  // Dead-join detection must be special-cased here: the fact query INNER JOINs
  // the cohort, so a namespace mismatch yields ZERO rows (not zero-valued
  // rows) and warnIfDeadJoin's per-point scan would never see it. Non-empty
  // cohort + zero fact rows + enough elapsed days = the mismatch signature.
  const totalEntered = entries.reduce((s, e) => s + e.n, 0);
  let joinWarning: string | null = warnIfDeadJoin(points, joined, req);
  if (points.length === 0 && totalEntered > 0) {
    const elapsedDays = Math.floor(
      (Date.now() - new Date(`${req.anchor}T00:00:00Z`).getTime()) / 86_400_000,
    );
    if (Math.min(elapsedDays, req.days) >= DEAD_JOIN_MIN_DAYS) {
      joinWarning =
        `entry-cohort join matched 0 mart rows for ${totalEntered} entered members ` +
        `(${req.gameId}/${req.binding.mart}) — likely identity-namespace mismatch between ` +
        `membership uid and ${req.binding.uidCol}`;
      console.warn(`[segment-metric-series] ${joinWarning}`);
    }
  }
  return { points, joinWarning };
}

async function readStayersLens(req: MetricSeriesRequest, connector: Connector): Promise<MetricSeriesResult> {
  const b = req.binding;
  const anchorLit = `DATE '${req.anchor}'`;
  const sql =
    `SELECT CAST(m.snapshot_date AS varchar) AS d, count(distinct m.uid) AS member_count, ` +
    `count(distinct f.${b.uidCol}) AS joined_members, ${valueExpr(b)} AS value ` +
    `FROM ${SEGMENT_MEMBERSHIP_DAILY} a ` +
    `JOIN ${SEGMENT_MEMBERSHIP_DAILY} m ` +
    `ON m.uid = a.uid AND m.game_id = a.game_id AND m.segment_id = a.segment_id ` +
    `LEFT JOIN ${factFqn(connector, req.gameId, b.mart)} f ` +
    `ON f.${b.uidCol} = m.uid AND f.${b.dateCol} = m.snapshot_date ` +
    `WHERE a.game_id = ${toSqlLiteral(req.gameId)} AND a.segment_id = ${toSqlLiteral(req.segmentId)} ` +
    `AND a.snapshot_date = ${anchorLit} ` +
    `AND m.snapshot_date >= ${anchorLit} ` +
    `AND m.snapshot_date <= date_add('day', ${Math.trunc(req.days)}, ${anchorLit}) ` +
    `GROUP BY 1 ORDER BY 1`;
  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, METRIC_SERIES_TIMEOUT_MS);
  const joined: number[] = [];
  const points = res.rows.map((r) => {
    joined.push(Number(r[2]));
    return { date: String(r[0]), memberCount: Number(r[1]), value: Number(r[3]) };
  });
  return { points, joinWarning: warnIfDeadJoin(points, joined, req) };
}
