/**
 * Read-side for lifecycle-state and payer-tier TRANSITION matrices.
 *
 * mf_users is a current-snapshot table with no history, so a from→to transition
 * matrix cannot be computed from a single read. The daily member-state snapshot
 * (segment_member_state_daily) accumulates per-uid `lifecycle_stage`,
 * `is_paying_user`, `payer_tier` and `install_date` keyed by snapshot_date —
 * so once TWO days exist, a self-join of the two latest snapshot dates on `uid`
 * yields the gross from→to movement. The whole matrix is computed in Trino
 * (classification via CASE), so at most ~25 rows ever cross the wire.
 *
 * Coverage caveat (disclosed to the caller, never hidden): the state table only
 * holds uids that belong to ≥1 snapshotted predicate segment — NOT the full game
 * population. So the transition matrix describes the TRACKED-segment cohort, a
 * subset. The live lifecycle state counts (Cube against full mf_users) and the
 * transition flows therefore come from different populations and must not be
 * summed against one another; the reader returns `coverageUsers` so the UI can
 * label the sample honestly.
 *
 * Read-only: no writes, no DDL. Degrades to `available:false` (with a reason)
 * when the lakehouse is unreachable or fewer than two snapshot days exist, so a
 * dev box with no accumulated snapshots renders an honest empty state.
 */

import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';
import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_SCHEMA,
  SEGMENT_MEMBER_STATE_DAILY,
  lakehouseSchemaForGame,
} from './lakehouse-trino-connector.js';

/** Strict ISO date guard for the snapshot-date literals we interpolate. The
 *  dates originate from our own DISTINCT query, but this is defence-in-depth so
 *  a malformed value can never reach SQL unquoted. */
export const SNAPSHOT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Env-tunable read timeout — sized to outlast a cold warehouse self-join. */
export const TRANSITION_READ_TIMEOUT_MS =
  Number(process.env.STATE_TRANSITION_TIMEOUT_MS) || 120_000;

export interface TransitionReaderOptions {
  connector?: Connector;
}

/** One from→to cell of a transition matrix (gross user count that moved). */
export interface TransitionCell {
  from: string;
  to: string;
  count: number;
}

export interface TransitionMatrixResult {
  available: boolean;
  /** The earlier of the two snapshot dates compared (YYYY-MM-DD), or null. */
  prevDate: string | null;
  /** The later (most recent) snapshot date compared (YYYY-MM-DD), or null. */
  currDate: string | null;
  /** Distinct snapshot days captured for this game (drives the "N of 2" message). */
  capturedDays: number;
  /** Users classified on BOTH dates — the transition sample size. */
  coverageUsers: number;
  cells: TransitionCell[];
  /** Honest disclosure of availability + coverage scope. */
  reason: string;
}

/** The 5 lifecycle states, in display order (mirrors the live classifier). */
export const LIFECYCLE_STATES = ['new', 'core', 'lapsing', 'reactivated', 'churned'] as const;

function emptyResult(capturedDays: number, reason: string): TransitionMatrixResult {
  return {
    available: false,
    prevDate: null,
    currDate: null,
    capturedDays,
    coverageUsers: 0,
    cells: [],
    reason,
  };
}

/**
 * The two most recent snapshot dates for a game where `requireCol` is non-null,
 * most-recent first. Returns 0, 1, or 2 dates.
 */
async function readLatestTwoDates(
  gameId: string,
  requireCol: 'lifecycle_stage' | 'payer_tier',
  connector: Connector,
): Promise<string[]> {
  const gameLit = toSqlLiteral(gameId);
  const sql =
    `SELECT DISTINCT CAST(snapshot_date AS VARCHAR) AS d\n` +
    `FROM ${SEGMENT_MEMBER_STATE_DAILY}\n` +
    `WHERE game_id = ${gameLit} AND ${requireCol} IS NOT NULL\n` +
    `ORDER BY d DESC\n` +
    `LIMIT 2`;
  const res = await runQuery(connector, LAKEHOUSE_SCHEMA, sql, TRANSITION_READ_TIMEOUT_MS);
  return res.rows.map((r) => String(r[0]).slice(0, 10)).filter((d) => SNAPSHOT_DATE_RE.test(d));
}

/**
 * Dedup CTE shared by both matrices: one row per (snapshot_date, uid), taking
 * the latest snapshot_ts within the date (a uid in N segments → N rows, all with
 * identical state, so latest-ts dedup is deterministic). Scoped to the two dates.
 */
function dedupCte(gameLit: string, prevLit: string, currLit: string, valueExpr: string): string {
  return (
    `WITH dedup AS (\n` +
    `  SELECT snapshot_date, uid, ${valueExpr}\n` +
    `         ROW_NUMBER() OVER (PARTITION BY snapshot_date, uid ORDER BY snapshot_ts DESC) AS rn\n` +
    `  FROM ${SEGMENT_MEMBER_STATE_DAILY}\n` +
    `  WHERE game_id = ${gameLit} AND snapshot_date IN (DATE ${prevLit}, DATE ${currLit})\n` +
    `)`
  );
}

/**
 * The lifecycle-state CASE expression. Mirrors the live classifier's priority
 * (New > Reactivated > Core > Lapsing > Churned); non-paying actives fall to
 * NULL and are excluded from the matrix (the flow models the monetisation
 * lifecycle, same as the Cube-side counts). `asofLit` is the date literal used
 * for the New threshold on that side.
 *
 * One deliberate difference from the live classifier: here the lanes are
 * MUTUALLY EXCLUSIVE — a recent-install user lands only in 'new', never also in
 * 'core'. A from→to matrix requires each uid in exactly one lane, so this is the
 * only coherent partition. The live state CARDS instead treat 'new' as an
 * overlay (a new payer is counted in BOTH new and core), so the Sankey's
 * cohort 'new'/'core' bars are NOT directly comparable to the cards above. The
 * coverage note discloses this.
 */
function lifecycleStateCase(asofLit: string): string {
  return (
    `CASE\n` +
    `  WHEN install_date IS NOT NULL AND install_date >= date_add('day', -7, DATE ${asofLit}) THEN 'new'\n` +
    `  WHEN stage IN ('churned','dormant') AND paying THEN 'reactivated'\n` +
    `  WHEN stage IN ('active_today','active_7d') AND paying THEN 'core'\n` +
    `  WHEN stage = 'active_30d' AND paying THEN 'lapsing'\n` +
    `  WHEN stage IN ('churned','dormant','registered_inactive') AND NOT paying THEN 'churned'\n` +
    `  ELSE NULL\n` +
    `END`
  );
}

/** Build the full lifecycle transition SQL for two dates. Exported for tests. */
export function buildLifecycleTransitionSql(gameId: string, prevDate: string, currDate: string): string {
  const gameLit = toSqlLiteral(gameId);
  const prevLit = toSqlLiteral(prevDate);
  const currLit = toSqlLiteral(currDate);
  // `paying` is the boolean form of the VARCHAR is_paying_user column.
  const valueExpr =
    `lifecycle_stage AS stage,\n` +
    `         lower(CAST(is_paying_user AS VARCHAR)) IN ('true','t','1') AS paying,\n` +
    `         install_date,`;
  return (
    dedupCte(gameLit, prevLit, currLit, valueExpr) +
    `,\n` +
    `prev AS (\n` +
    `  SELECT uid, ${lifecycleStateCase(prevLit)} AS state\n` +
    `  FROM dedup WHERE snapshot_date = DATE ${prevLit} AND rn = 1\n` +
    `),\n` +
    `curr AS (\n` +
    `  SELECT uid, ${lifecycleStateCase(currLit)} AS state\n` +
    `  FROM dedup WHERE snapshot_date = DATE ${currLit} AND rn = 1\n` +
    `)\n` +
    `SELECT p.state AS from_state, c.state AS to_state, COUNT(*) AS cnt\n` +
    `FROM prev p JOIN curr c ON p.uid = c.uid\n` +
    `WHERE p.state IS NOT NULL AND c.state IS NOT NULL\n` +
    `GROUP BY 1, 2`
  );
}

/** Build the full payer-tier migration SQL for two dates. Exported for tests. */
export function buildTierMigrationSql(gameId: string, prevDate: string, currDate: string): string {
  const gameLit = toSqlLiteral(gameId);
  const prevLit = toSqlLiteral(prevDate);
  const currLit = toSqlLiteral(currDate);
  const valueExpr = `COALESCE(CAST(payer_tier AS VARCHAR), 'unknown') AS tier,`;
  return (
    dedupCte(gameLit, prevLit, currLit, valueExpr) +
    `,\n` +
    `prev AS (SELECT uid, tier FROM dedup WHERE snapshot_date = DATE ${prevLit} AND rn = 1),\n` +
    `curr AS (SELECT uid, tier FROM dedup WHERE snapshot_date = DATE ${currLit} AND rn = 1)\n` +
    `SELECT p.tier AS from_state, c.tier AS to_state, COUNT(*) AS cnt\n` +
    `FROM prev p JOIN curr c ON p.uid = c.uid\n` +
    `GROUP BY 1, 2`
  );
}

type SqlBuilder = (gameId: string, prevDate: string, currDate: string) => string;

/**
 * Shared driver: resolve the two latest dates, run the matrix SQL, assemble the
 * result. Catches lakehouse failures and degrades to an honest empty state.
 */
async function readMatrix(
  gameId: string,
  requireCol: 'lifecycle_stage' | 'payer_tier',
  build: SqlBuilder,
  kind: 'lifecycle transition' | 'tier migration',
  opts: TransitionReaderOptions,
): Promise<TransitionMatrixResult> {
  if (!lakehouseSchemaForGame(gameId)) {
    return emptyResult(0, `${kind} not available: "${gameId}" is not mapped to a lakehouse schema.`);
  }

  const connector = opts.connector ?? lakehouseConnectorFromEnv();

  let dates: string[];
  try {
    dates = await readLatestTwoDates(gameId, requireCol, connector);
  } catch (err) {
    // Surfaced in the response `reason`; also log so an operator can tell
    // "store unreachable" apart from "still accumulating" (the response alone
    // can't, and there are no other server logs for this read).
    console.warn(`[state-transition-reader] ${kind} dates query failed for ${gameId}:`, (err as Error).message);
    return emptyResult(
      0,
      `${kind} not available yet: the daily snapshot store is not reachable ` +
        `(${(err as Error).message}). It populates once snapshots accumulate.`,
    );
  }

  if (dates.length < 2) {
    return emptyResult(
      dates.length,
      `${kind} accumulating: ${dates.length} of 2 daily snapshots captured. ` +
        `Flows populate once a second day lands.`,
    );
  }

  // dates is most-recent-first → [currDate, prevDate].
  const [currDate, prevDate] = dates;
  let cells: TransitionCell[];
  try {
    const res = await runQuery(connector, LAKEHOUSE_SCHEMA, build(gameId, prevDate, currDate), TRANSITION_READ_TIMEOUT_MS);
    cells = res.rows
      .map((r) => ({ from: String(r[0]), to: String(r[1]), count: Number(r[2] ?? 0) }))
      .filter((c) => c.count > 0);
  } catch (err) {
    console.warn(`[state-transition-reader] ${kind} matrix query failed for ${gameId}:`, (err as Error).message);
    return emptyResult(
      dates.length,
      `${kind} query failed: ${(err as Error).message}. Flows populate once the store recovers.`,
    );
  }

  const coverageUsers = cells.reduce((s, c) => s + c.count, 0);
  // The lifecycle matrix uses mutually-exclusive lanes (see lifecycleStateCase),
  // so its 'new'/'core' bars aren't directly comparable to the overlay-counted
  // state cards above — disclose that alongside the population-scope caveat.
  const laneNote =
    kind === 'lifecycle transition'
      ? ' Flow lanes are mutually exclusive (a recent install appears only under New), ' +
        'unlike the overlay-counted state cards above.'
      : '';
  return {
    available: true,
    prevDate,
    currDate,
    capturedDays: dates.length,
    coverageUsers,
    cells,
    reason:
      `Flows observed among ${coverageUsers.toLocaleString()} tracked-segment users ` +
      `between ${prevDate} and ${currDate}. Node totals reflect the full-population ` +
      `current state; flows cover only users in snapshotted segments.${laneNote}`,
  };
}

/** Lifecycle 5-state from→to matrix for a game (two latest snapshot days). */
export function readLifecycleTransitions(
  gameId: string,
  opts: TransitionReaderOptions = {},
): Promise<TransitionMatrixResult> {
  return readMatrix(gameId, 'lifecycle_stage', buildLifecycleTransitionSql, 'lifecycle transition', opts);
}

/** Payer-tier from→to migration matrix for a game (two latest snapshot days). */
export function readTierMigration(
  gameId: string,
  opts: TransitionReaderOptions = {},
): Promise<TransitionMatrixResult> {
  return readMatrix(gameId, 'payer_tier', buildTierMigrationSql, 'tier migration', opts);
}
