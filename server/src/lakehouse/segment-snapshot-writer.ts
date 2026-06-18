/**
 * Phase: snapshot writer.
 *
 * For one segment + date, compile its membership query to Trino SQL via Cube
 * /sql, then run a cross-catalog INSERT … SELECT so Trino lands the FULL cohort
 * into stag_iceberg.khoitn.segment_membership_daily — no app-side row shipping,
 * no MAX_UID_LIST cap (unlike refresh-segment, which paginates a capped sample
 * into SQLite).
 *
 * Idempotent per (date, game, segment): the partition slice is DELETEd before
 * the INSERT (row-level delete verified on the Iceberg connector).
 *
 * Non-atomic window: Iceberg has no multi-statement transaction over the REST
 * transport, so a crash/timeout between DELETE and INSERT leaves that segment's
 * D partition empty until the next successful run. This is self-correcting and
 * does NOT corrupt the delta: the delta scopes to segments present in D's
 * snapshot, so an empty partition simply yields no change rows for that segment
 * (not a spurious 'exited'). The post-INSERT count distinguishes a real write
 * from a silent-empty partition.
 */

import { sql as cubeSql } from '../services/cube-client.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { resolveIdentityField } from '../services/resolve-identity-field.js';
import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { inlineSqlParams, toSqlLiteral } from './inline-sql-params.js';
import {
  lakehouseConnectorFromEnv,
  lakehouseSchemaForGame,
  SEGMENT_MEMBERSHIP_DAILY,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from './lakehouse-trino-connector.js';

export interface SegmentSnapshotInput {
  segmentId: string;
  gameId: string;
  cube: string;
  workspace: string;
  /** The segment's stored Cube query JSON (filters/segments predicate). */
  cubeQueryJson: string;
}

export interface SnapshotWriteResult {
  segmentId: string;
  gameId: string;
  snapshotDate: string;
  status: 'written' | 'skipped' | 'error';
  /** Rows in the landed partition (from a post-INSERT count). */
  rowCount?: number;
  reason?: string;
  error?: string;
}

export interface SnapshotWriteOptions {
  /** Injectable for tests; defaults to the env-derived lakehouse connector. */
  connector?: Connector;
  /** Cube token override; defaults to the per-game minted token. */
  token?: string;
  /**
   * Canonical snapshot timestamp (floored to cadence bucket) as
   * 'YYYY-MM-DD HH:MM:00'. When omitted the DELETE/INSERT slice keys by
   * snapshot_date only (legacy daily-only path). When provided the slice
   * is additionally keyed on snapshot_ts so sub-daily cadences are idempotent.
   */
  snapshotTs?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strip the trailing row cap (Cube's default rowLimit) so the INSERT lands the
 *  full cohort, not a capped sample. Handles both Trino dialect forms —
 *  `LIMIT n [OFFSET m]` and `FETCH FIRST n ROWS ONLY`. The membership SELECT's
 *  only cap is this outer one; subquery limits (if any) are untouched because we
 *  anchor to end-of-string. */
export function stripTrailingLimit(sqlText: string): string {
  return sqlText
    .replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, '')
    .replace(/\s+FETCH\s+FIRST\s+\d+\s+ROWS?\s+ONLY\s*$/i, '');
}

interface CompiledSql {
  text: string;
  params: unknown[];
}

function extractCompiledSql(resp: unknown): CompiledSql {
  const pair = (resp as { sql?: { sql?: [string, unknown[]] } })?.sql?.sql;
  if (!Array.isArray(pair) || typeof pair[0] !== 'string') {
    throw new Error('Cube /sql returned no [sqlText, params] pair');
  }
  return { text: pair[0], params: Array.isArray(pair[1]) ? pair[1] : [] };
}

/**
 * Compile + write one segment's full membership for `snapshotDate` (YYYY-MM-DD).
 * Returns a structured result for the job log rather than throwing on a single
 * segment's failure (the caller continues to the next segment).
 */
export async function writeSegmentSnapshot(
  input: SegmentSnapshotInput,
  snapshotDate: string,
  opts: SnapshotWriteOptions = {},
): Promise<SnapshotWriteResult> {
  const base: Pick<SnapshotWriteResult, 'segmentId' | 'gameId' | 'snapshotDate'> = {
    segmentId: input.segmentId,
    gameId: input.gameId,
    snapshotDate,
  };

  if (!DATE_RE.test(snapshotDate)) {
    return { ...base, status: 'error', error: `invalid snapshotDate: ${snapshotDate}` };
  }

  const schema = lakehouseSchemaForGame(input.gameId);
  if (!schema) {
    return { ...base, status: 'skipped', reason: `no Trino schema for game ${input.gameId}` };
  }

  try {
    const identity = await resolveIdentityField(input.cube, input.gameId, {
      workspaceId: input.workspace,
    });
    if (!identity) {
      return { ...base, status: 'skipped', reason: `no identity-field mapping for ${input.cube}` };
    }

    const token = opts.token ?? resolveCubeTokenForGame(input.gameId) ?? undefined;
    const baseQuery = JSON.parse(input.cubeQueryJson) as Record<string, unknown>;
    // Identity-only projection → one column, one row per distinct user (Cube
    // emits GROUP BY on the dimension). Drop measures so the subquery is a
    // single column the INSERT can map positionally to `uid`.
    const query = { ...baseQuery, dimensions: [identity], measures: [] };

    const compiled = extractCompiledSql(await cubeSql(query, token));
    const selectSql = stripTrailingLimit(inlineSqlParams(compiled.text, compiled.params));

    const connector = opts.connector ?? lakehouseConnectorFromEnv();
    const dateLit = `DATE '${snapshotDate}'`;
    const gameLit = toSqlLiteral(input.gameId);
    const segLit = toSqlLiteral(input.segmentId);

    // When a snapshot_ts is provided, the idempotent slice keys on both
    // snapshot_date AND snapshot_ts so sub-daily cadences don't clobber each
    // other's buckets. The legacy daily path (no snapshotTs) slices by date
    // only — existing row shapes are unchanged.
    const tsTerm = opts.snapshotTs
      ? ` AND snapshot_ts = TIMESTAMP '${opts.snapshotTs}'`
      : '';
    const tsSelectCol = opts.snapshotTs
      ? `, TIMESTAMP '${opts.snapshotTs}' AS snapshot_ts`
      : '';
    const tsInsertCol = opts.snapshotTs ? ', snapshot_ts' : '';

    // Idempotent: clear the partition slice, then land the full cohort. The
    // target columns are listed explicitly so a future table-column reorder
    // can't silently misalign; m.* is the subquery's single identity column
    // (guaranteed by dimensions:[identity] + measures:[]) → maps to `uid`.
    const deleteSql =
      `DELETE FROM ${SEGMENT_MEMBERSHIP_DAILY} ` +
      `WHERE snapshot_date = ${dateLit} AND game_id = ${gameLit} AND segment_id = ${segLit}` +
      tsTerm;
    const insertSql =
      `INSERT INTO ${SEGMENT_MEMBERSHIP_DAILY} (snapshot_date, game_id, segment_id, uid${tsInsertCol}) ` +
      `SELECT ${dateLit} AS snapshot_date, ${gameLit} AS game_id, ${segLit} AS segment_id, m.*${tsSelectCol} ` +
      `FROM ( ${selectSql} ) AS m`;

    await runQuery(connector, schema, deleteSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
    await runQuery(connector, schema, insertSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);

    const countSql =
      `SELECT count(*) FROM ${SEGMENT_MEMBERSHIP_DAILY} ` +
      `WHERE snapshot_date = ${dateLit} AND game_id = ${gameLit} AND segment_id = ${segLit}` +
      tsTerm;
    const countRes = await runQuery(connector, schema, countSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
    const rowCount = Number(countRes.rows[0]?.[0] ?? 0);

    return { ...base, status: 'written', rowCount };
  } catch (err) {
    return { ...base, status: 'error', error: (err as Error).message };
  }
}
