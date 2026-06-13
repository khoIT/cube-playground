/**
 * Per-member recharge before/after a CS contact, off
 * `game_integration.<schema>.std_ingame_user_recharge_daily`.
 *
 * Powers the directional "CS impact" strip: for each member with an anchor date
 * (a contacted member's first ticket date; or a shared calendar anchor for the
 * non-contacted comparison cohort), sum recharge in the [anchor-W, anchor)
 * window vs the (anchor, anchor+W] window. Anchors are passed in per uid, so a
 * single query covers a whole cohort whose members each have their own anchor.
 *
 * The warehouse `user_id` is `<uid>@<realm>`; we match on
 * `split_part(user_id,'@',1)` exactly as the cube model's join does.
 *
 * Strictly read-only and bounded — the outer scan is clamped to the union of
 * all per-uid windows so cold Trino doesn't scan the full recharge history.
 */

import { runQuery } from '../services/trino-rest-client.js';
import { type Connector, schemaForGame } from '../services/trino-profiler-config.js';
import { resolveCsTrinoConnector } from './cs-trino-connector.js';
import { toSqlLiteral } from './inline-sql-params.js';

export const RECHARGE_READ_TIMEOUT_MS = 30_000;

/** Default ± window (days) around the anchor for the pre/post comparison. */
export const DEFAULT_WINDOW_DAYS = 30;

export interface MemberAnchor {
  uid: string;
  /** `YYYY-MM-DD` — recharge pre/post is measured around this date. */
  anchor: string;
}

export interface RechargeWindowSums {
  uid: string;
  /** Sum of recharge in [anchor-windowDays, anchor). */
  pre: number;
  /** Sum of recharge in (anchor, anchor+windowDays]. */
  post: number;
}

export interface CohortRechargeStats {
  n: number;
  avgRevPre: number;
  avgRevPost: number;
  /** (avgRevPost - avgRevPre) / avgRevPre * 100, or null when avgRevPre is 0. */
  deltaPct: number | null;
}

export interface ReadRechargeOptions {
  gameId: string;
  anchors: MemberAnchor[];
  windowDays?: number;
  connector?: Connector;
}

function sanitizeUid(uid: string): string | null {
  const u = String(uid).trim();
  return u && /^[A-Za-z0-9_-]+$/.test(u) ? u : null;
}

/** ISO date string compare is lexicographic-safe for `YYYY-MM-DD`. */
function minDate(dates: string[]): string {
  return dates.reduce((a, b) => (a < b ? a : b));
}
function maxDate(dates: string[]): string {
  return dates.reduce((a, b) => (a > b ? a : b));
}

/**
 * Sum pre/post recharge for each anchored member. Members with no recharge in
 * either window come back with pre=0/post=0 (the cohort average still counts
 * them — a member who stopped spending is signal, not a gap to drop).
 */
export async function readRechargeAroundAnchors(
  opts: ReadRechargeOptions,
): Promise<RechargeWindowSums[]> {
  const windowDays = Math.trunc(opts.windowDays ?? DEFAULT_WINDOW_DAYS);
  const clean = opts.anchors
    .map((a) => ({ uid: sanitizeUid(a.uid), anchor: a.anchor }))
    .filter((a): a is MemberAnchor => a.uid !== null && /^\d{4}-\d{2}-\d{2}$/.test(a.anchor));
  if (clean.length === 0) return [];

  const schema = schemaForGame(opts.gameId);
  if (!schema) throw new Error(`Recharge trajectory: no schema mapping for game ${opts.gameId}`);
  const connector = opts.connector ?? resolveCsTrinoConnector();
  if (!connector) throw new Error('Recharge trajectory: no Trino connector configured');

  const anchorDates = clean.map((a) => a.anchor);
  const scanLo = minDate(anchorDates);
  const scanHi = maxDate(anchorDates);
  const table = `game_integration.${schema}.std_ingame_user_recharge_daily`;

  const valuesList = clean
    .map((a) => `(${toSqlLiteral(a.uid)}, DATE ${toSqlLiteral(a.anchor)})`)
    .join(', ');

  const sql =
    `WITH anchors(uid, anchor) AS (VALUES ${valuesList}) ` +
    `SELECT a.uid, ` +
    `COALESCE(sum(CASE WHEN r.log_date >= date_add('day', -${windowDays}, a.anchor) AND r.log_date < a.anchor ` +
    `THEN r.ingame_total_recharge_value_vnd ELSE 0 END), 0) AS pre, ` +
    `COALESCE(sum(CASE WHEN r.log_date > a.anchor AND r.log_date <= date_add('day', ${windowDays}, a.anchor) ` +
    `THEN r.ingame_total_recharge_value_vnd ELSE 0 END), 0) AS post ` +
    `FROM anchors a ` +
    `LEFT JOIN ${table} r ` +
    `ON split_part(r.user_id, '@', 1) = a.uid ` +
    `AND r.log_date >= date_add('day', -${windowDays}, DATE ${toSqlLiteral(scanLo)}) ` +
    `AND r.log_date <= date_add('day', ${windowDays}, DATE ${toSqlLiteral(scanHi)}) ` +
    `GROUP BY a.uid`;

  const res = await runQuery(connector, connector.catalog, sql, RECHARGE_READ_TIMEOUT_MS);
  return res.rows.map((r) => ({ uid: String(r[0]), pre: Number(r[1]) || 0, post: Number(r[2]) || 0 }));
}

/** Aggregate per-uid sums into cohort averages + a directional delta %. */
export function summarizeCohortRecharge(sums: RechargeWindowSums[]): CohortRechargeStats {
  const n = sums.length;
  if (n === 0) return { n: 0, avgRevPre: 0, avgRevPost: 0, deltaPct: null };
  const totalPre = sums.reduce((s, x) => s + x.pre, 0);
  const totalPost = sums.reduce((s, x) => s + x.post, 0);
  const avgRevPre = totalPre / n;
  const avgRevPost = totalPost / n;
  const deltaPct = avgRevPre > 0 ? ((avgRevPost - avgRevPre) / avgRevPre) * 100 : null;
  return { n, avgRevPre, avgRevPost, deltaPct };
}
