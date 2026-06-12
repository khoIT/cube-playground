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
  LAKEHOUSE_CATALOG,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from './lakehouse-trino-connector.js';

export const SEGMENT_DEFINITION_DAILY = `${LAKEHOUSE_CATALOG}.${LAKEHOUSE_SCHEMA}.segment_definition_daily`;

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
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function capJson(raw: string | null, segmentId: string, col: string): string | null {
  if (raw == null || raw.length <= MAX_JSON_CHARS) return raw;
  console.warn(
    `[segment-definition-writer] ${segmentId}.${col} truncated (${raw.length} chars)`,
  );
  return raw.slice(0, MAX_JSON_CHARS) + '…[truncated]';
}

/** One VALUES tuple per segment — all literals escaped via toSqlLiteral. */
export function definitionValuesTuple(
  seg: SegmentDefinitionSnapshotInput,
  snapshotDate: string,
  identityField: string | null,
): string {
  const hash = segmentDefinitionHash({
    type: seg.type,
    cube: seg.cube,
    game_id: seg.gameId,
    predicate_tree_json: seg.predicateTreeJson,
  });
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
    ')'
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
      tuples.push(definitionValuesTuple(seg, snapshotDate, identity));
    }

    const dateLit = `DATE '${snapshotDate}'`;
    const deleteSql = `DELETE FROM ${SEGMENT_DEFINITION_DAILY} WHERE snapshot_date = ${dateLit}`;
    const insertSql =
      `INSERT INTO ${SEGMENT_DEFINITION_DAILY} ` +
      `(snapshot_date, game_id, segment_id, definition_hash, name, cube_name, type, identity_field, predicate_tree_json, cube_query_json) ` +
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
