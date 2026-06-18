/**
 * Daily definition snapshot writer: lands one row per eligible segment into
 * stag_iceberg.khoitn.segment_definition_daily, recording the definition that
 * produced (or attempted) that day's membership partition.
 *
 * Runs BEFORE the membership loop in the nightly job, in one statement for all
 * segments — a segment whose membership INSERT later errors still gets its
 * definition row (history of what was attempted). Idempotent per date:
 * DELETE the date slice → single batched INSERT … VALUES.
 *
 * Failure isolation: this writer never throws — a definition-write failure
 * must not abort the membership loop. Identity resolution failures degrade to
 * a NULL identity_field on that row rather than dropping the row.
 */

import { resolveIdentityField } from '../services/resolve-identity-field.js';
import { segmentDefinitionHash } from '../services/segment-definition-hash.js';
import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';
import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_SCHEMA,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
  SEGMENT_DEFINITION_DAILY,
} from './lakehouse-trino-connector.js';

// Re-exported from the connector (single env-scoped source of truth) so existing
// importers of this symbol keep working.
export { SEGMENT_DEFINITION_DAILY };

/** Defensive cap for JSON VARCHAR columns. Predicate trees are <10KB in
 *  practice; anything past the cap is truncated with a marker (and logged) so
 *  one pathological segment can't bloat the day's INSERT statement. */
const MAX_JSON_CHARS = 100_000;

export interface SegmentDefinitionSnapshotInput {
  segmentId: string;
  gameId: string;
  cube: string;
  workspace: string;
  name: string;
  type: string;
  predicateTreeJson: string | null;
  cubeQueryJson: string;
}

export interface DefinitionWriteResult {
  snapshotDate: string;
  status: 'written' | 'skipped' | 'error';
  rowCount?: number;
  error?: string;
}

export interface DefinitionWriteOptions {
  /** Injectable for tests; defaults to the env-derived lakehouse connector. */
  connector?: Connector;
  /**
   * Canonical snapshot_ts for this snapshot run ('YYYY-MM-DD HH:MM:00').
   * Stamped on every definition row so the movement API can derive cadence
   * changes by lagging snapshot_cadence over time. Omitted for legacy daily runs.
   */
  snapshotTs?: string;
  /**
   * Snapshot cadence of the segment at this run (e.g. 'daily', '1h'). Stored
   * per-snapshot so the history of cadence changes is queryable.
   */
  snapshotCadence?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function capJson(raw: string | null, segmentId: string, col: string): string | null {
  if (raw == null || raw.length <= MAX_JSON_CHARS) return raw;
  console.warn(
    `[segment-definition-writer] ${segmentId}.${col} truncated (${raw.length} chars)`,
  );
  return raw.slice(0, MAX_JSON_CHARS) + '…[truncated]';
}

/** One VALUES tuple per segment — all literals escaped via toSqlLiteral.
 *  Includes optional snapshot_ts and snapshot_cadence when provided, so the
 *  definition history carries the cadence that was active at capture time. */
export function definitionValuesTuple(
  seg: SegmentDefinitionSnapshotInput,
  snapshotDate: string,
  identityField: string | null,
  snapshotTs?: string,
  snapshotCadence?: string,
): string {
  const hash = segmentDefinitionHash({
    type: seg.type,
    cube: seg.cube,
    game_id: seg.gameId,
    predicate_tree_json: seg.predicateTreeJson,
  });
  const tsCol = snapshotTs ? `, TIMESTAMP '${snapshotTs}'` : ', NULL';
  const cadenceCol = toSqlLiteral(snapshotCadence ?? null);
  return (
    `(DATE '${snapshotDate}', ` +
    [
      toSqlLiteral(seg.gameId),
      toSqlLiteral(seg.segmentId),
      toSqlLiteral(hash),
      toSqlLiteral(seg.name),
      toSqlLiteral(seg.cube),
      toSqlLiteral(seg.type),
      toSqlLiteral(identityField),
      toSqlLiteral(capJson(seg.predicateTreeJson, seg.segmentId, 'predicate_tree_json')),
      toSqlLiteral(capJson(seg.cubeQueryJson, seg.segmentId, 'cube_query_json')),
    ].join(', ') +
    `${tsCol}, ${cadenceCol})`
  );
}

/**
 * Land all eligible segments' definitions for `snapshotDate`. Never throws —
 * returns a structured result for the job heartbeat.
 */
export async function writeSegmentDefinitions(
  segments: SegmentDefinitionSnapshotInput[],
  snapshotDate: string,
  opts: DefinitionWriteOptions = {},
): Promise<DefinitionWriteResult> {
  if (!DATE_RE.test(snapshotDate)) {
    return { snapshotDate, status: 'error', error: `invalid snapshotDate: ${snapshotDate}` };
  }
  if (segments.length === 0) {
    return { snapshotDate, status: 'skipped', rowCount: 0 };
  }

  try {
    const connector = opts.connector ?? lakehouseConnectorFromEnv();

    // Resolve identity per segment; a resolution failure degrades that row to
    // NULL identity_field (the row itself must still land).
    const tuples: string[] = [];
    for (const seg of segments) {
      let identity: string | null = null;
      try {
        identity = await resolveIdentityField(seg.cube, seg.gameId, {
          workspaceId: seg.workspace,
        });
      } catch {
        identity = null;
      }
      tuples.push(definitionValuesTuple(seg, snapshotDate, identity, opts.snapshotTs, opts.snapshotCadence));
    }

    const dateLit = `DATE '${snapshotDate}'`;
    // When snapshotTs is provided the DELETE is keyed on (date, snapshot_ts) so
    // sub-daily cadence re-runs only overwrite the same bucket, not the whole
    // day's definitions. Legacy daily runs (no snapshotTs) clear the day slice.
    const tsTerm = opts.snapshotTs
      ? ` AND snapshot_ts = TIMESTAMP '${opts.snapshotTs}'`
      : '';
    const deleteSql =
      `DELETE FROM ${SEGMENT_DEFINITION_DAILY} WHERE snapshot_date = ${dateLit}${tsTerm}`;
    const insertSql =
      `INSERT INTO ${SEGMENT_DEFINITION_DAILY} ` +
      `(snapshot_date, game_id, segment_id, definition_hash, name, cube_name, type, identity_field, predicate_tree_json, cube_query_json, snapshot_ts, snapshot_cadence) ` +
      `VALUES ${tuples.join(', ')}`;

    await runQuery(connector, LAKEHOUSE_SCHEMA, deleteSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
    await runQuery(connector, LAKEHOUSE_SCHEMA, insertSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);

    const countSql = `SELECT count(*) FROM ${SEGMENT_DEFINITION_DAILY} WHERE snapshot_date = ${dateLit}`;
    const countRes = await runQuery(connector, LAKEHOUSE_SCHEMA, countSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
    return { snapshotDate, status: 'written', rowCount: Number(countRes.rows[0]?.[0] ?? 0) };
  } catch (err) {
    return { snapshotDate, status: 'error', error: (err as Error).message };
  }
}
