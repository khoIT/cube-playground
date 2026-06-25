/**
 * Full-cohort export stream for the public API (Phase 03).
 *
 * Given a segment row, yields encoded NDJSON/CSV chunks straight from Trino —
 * keyset-paginated on `uid`, one page in memory at a time, never the whole
 * cohort. The route pipes these chunks to `reply.raw`; a slow client paces the
 * next page via backpressure.
 *
 * Source selection: if a lakehouse `segment_membership_daily` partition exists
 * for the segment, stream from that pre-deduped table (cheapest); otherwise
 * compile the segment's live predicate to a runnable SELECT and stream that.
 *
 * Completion contract: a `200 OK` on a hijacked stream cannot be downgraded
 * mid-flight, so a truncated pull is byte-indistinguishable from a complete one.
 * We close the gap with a trailing sentinel emitted ONLY after the final page
 * drains cleanly — NDJSON `{"_complete":true,"count":N}`, CSV `# complete,N`.
 * If the stream errors mid-flight the sentinel is never written. The route also
 * sends `X-Total-Count` up-front as a cheap cross-check.
 *
 * Forward-compatible field projection: the SELECT + encoders are driven by a
 * `fields[]` list (server-side allowlist = the security boundary). v1's first
 * ship serves `uid` only; adding a field is extend-the-allowlist + extend-the
 * source projection, with no encoder rewrite (NDJSON keys / CSV columns are
 * additive, `uid` always first). The keyset cursor always stays on `uid`.
 */

import { streamQuery } from './trino-rest-client.js';
import { schemaForGame } from './trino-profiler-config.js';
import { toSqlLiteral } from '../lakehouse/inline-sql-params.js';
import { buildSegmentMembershipSql } from '../lakehouse/segment-snapshot-writer.js';
import {
  lakehouseConnectorFromEnv,
  SEGMENT_MEMBERSHIP_DAILY,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from '../lakehouse/lakehouse-trino-connector.js';

/** Columns a key may request via `?fields=`. v1 first ship = uid only; grows
 *  over time (additive, non-breaking). uid is mandatory and always first. */
export const AVAILABLE_FIELDS = ['uid'] as const;
export type ExportField = (typeof AVAILABLE_FIELDS)[number];

export type ExportFormat = 'ndjson' | 'csv';

/** Minimal segment row shape the exporter needs. */
export interface ExportSegmentRow {
  id: string;
  game_id: string;
  cube?: string | null;
  workspace?: string | null;
  type?: string | null;
  cube_query_json?: string | null;
}

export interface ExportOptions {
  format: ExportFormat;
  fields: ExportField[];
  cursor: string | null;
  /** Cap total rows (testing); absent = full cohort. */
  limit?: number | null;
  signal: AbortSignal;
}

/** One emitted chunk. The route writes `text`, advances the audit counter by
 *  `rowsInChunk`, and on `sentinel` records the authoritative `totalRows`. */
export interface ExportChunk {
  text: string;
  rowsInChunk: number;
  sentinel?: boolean;
  totalRows?: number;
}

/** Thrown when `?fields=` names a column outside the allowlist → route maps 400. */
export class UnknownFieldError extends Error {
  constructor(public readonly field: string) {
    super(`Unknown field '${field}'. Allowed: ${AVAILABLE_FIELDS.join(', ')}`);
    this.name = 'UnknownFieldError';
  }
}

/** Validate `?fields=` → an allowlisted list with uid forced first. Default uid. */
export function parseFields(raw: string | undefined): ExportField[] {
  if (!raw) return ['uid'];
  const requested = raw
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  for (const f of requested) {
    if (!(AVAILABLE_FIELDS as readonly string[]).includes(f)) throw new UnknownFieldError(f);
  }
  const set = new Set<ExportField>(['uid', ...(requested as ExportField[])]);
  // uid first, then the rest in allowlist order (stable, additive).
  return AVAILABLE_FIELDS.filter((f) => set.has(f));
}

/** Keyset page size — read per-call so it can be tuned via env without a
 *  module-load snapshot (also keeps it test-overridable). */
function pageSize(): number {
  return Number(process.env.PUBLIC_EXPORT_PAGE_SIZE) || 50_000;
}

export type ExportSourcePath = 'table' | 'live';

export interface ResolvedSource {
  path: ExportSourcePath;
  /** Inner SELECT producing exactly the requested columns (uid first), unkeyed.
   *  Wrapped by the keyset pager. */
  innerSql: string;
  /** Trino session schema for bare table refs in the live compiled SELECT. */
  schema: string;
}

/**
 * Decide table vs live and build the inner (unpaged) SELECT projecting the
 * requested fields with `uid` as the first/keyset column. The table path is
 * pre-deduped; the live path wraps the compiled membership SELECT in a DISTINCT
 * so the keyset cursor stays monotonic even if identity rows duplicate.
 */
export async function resolveExportSource(
  row: ExportSegmentRow,
  fields: ExportField[],
): Promise<ResolvedSource> {
  const schema = schemaForGame(row.game_id) ?? '';
  const projection = fields.join(', ');

  // Probe for a daily partition (cheap max(snapshot_date)). Any failure (e.g. no
  // lakehouse configured locally) falls through to the live predicate path.
  const latestDate = await probeLatestPartition(row).catch(() => null);
  if (latestDate) {
    const innerSql =
      `SELECT ${projection} FROM ${SEGMENT_MEMBERSHIP_DAILY} ` +
      `WHERE snapshot_date = DATE ${toSqlLiteral(latestDate)} ` +
      `AND game_id = ${toSqlLiteral(row.game_id)} ` +
      `AND segment_id = ${toSqlLiteral(row.id)}`;
    return { path: 'table', innerSql, schema };
  }

  // Live path: compile the segment's predicate to an identity-only SELECT, then
  // alias its single column to `uid` and DISTINCT it. Only predicate segments
  // have a generating query.
  if (row.type !== 'predicate' || !row.cube || !row.cube_query_json) {
    throw new Error('No daily snapshot partition and segment is not a live predicate — nothing to export.');
  }
  const built = await buildSegmentMembershipSql({
    cube: row.cube,
    gameId: row.game_id,
    workspace: (row.workspace as string) ?? 'local',
    cubeQueryJson: row.cube_query_json,
  });
  if (!built) throw new Error(`No identity-field mapping for ${row.cube}`);
  // `(<compiled>) AS t (uid)` renames the single output column to uid regardless
  // of its Cube alias, so the keyset wrapper below is uniform across both paths.
  const innerSql = `SELECT DISTINCT ${projection} FROM ( ${built.sql} ) AS t (uid)`;
  return { path: 'live', innerSql, schema };
}

/** Whether a lakehouse daily partition exists for this segment (table path).
 *  Best-effort — any probe failure (no lakehouse locally) resolves to false. */
export async function hasSnapshotPartition(row: ExportSegmentRow): Promise<boolean> {
  const latest = await probeLatestPartition(row).catch(() => null);
  return latest !== null;
}

async function probeLatestPartition(row: ExportSegmentRow): Promise<string | null> {
  const connector = lakehouseConnectorFromEnv();
  const sql =
    `SELECT max(snapshot_date) FROM ${SEGMENT_MEMBERSHIP_DAILY} ` +
    `WHERE segment_id = ${toSqlLiteral(row.id)} AND game_id = ${toSqlLiteral(row.game_id)}`;
  let value: unknown = null;
  for await (const batch of streamQuery(connector, schemaForGame(row.game_id) ?? '', sql, {
    timeoutMs: LAKEHOUSE_STATEMENT_TIMEOUT_MS,
  })) {
    if (batch.rows.length) value = batch.rows[0][0];
  }
  if (value === null || value === undefined) return null;
  // Trino returns DATE as 'YYYY-MM-DD'.
  return String(value);
}

// ---- encoders --------------------------------------------------------------

function encodeNdjsonRow(fields: ExportField[], row: unknown[]): string {
  const obj: Record<string, unknown> = {};
  fields.forEach((f, i) => {
    obj[f] = row[i];
  });
  return `${JSON.stringify(obj)}\n`;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function encodeCsvRow(fields: ExportField[], row: unknown[]): string {
  return `${fields.map((_, i) => csvCell(row[i])).join(',')}\n`;
}

/**
 * Resolve the source then stream the cohort. Convenience wrapper used by tests;
 * the route resolves the source FIRST (so a "nothing to export" error becomes a
 * pre-hijack 4xx) and then calls {@link streamExportPages} directly.
 */
export async function* streamSegmentExport(
  row: ExportSegmentRow,
  opts: ExportOptions,
): AsyncGenerator<ExportChunk, void, undefined> {
  const source = await resolveExportSource(row, opts.fields);
  yield* streamExportPages(source, opts);
}

/**
 * Stream the cohort from an already-resolved source as encoded chunks. Loops
 * keyset pages until a short page, then emits the completion sentinel as the
 * final chunk. The first CSV chunk carries the header row.
 */
export async function* streamExportPages(
  source: ResolvedSource,
  opts: ExportOptions,
): AsyncGenerator<ExportChunk, void, undefined> {
  const { format, fields, signal } = opts;
  const connector = lakehouseConnectorFromEnv();

  let cursor = opts.cursor;
  let total = 0;
  const cap = opts.limit && opts.limit > 0 ? opts.limit : null;
  const PAGE_SIZE = pageSize();

  if (format === 'csv') {
    yield { text: `${fields.join(',')}\n`, rowsInChunk: 0 };
  }

  for (;;) {
    const remaining = cap === null ? PAGE_SIZE : Math.min(PAGE_SIZE, cap - total);
    if (remaining <= 0) break;

    const where = cursor !== null ? `WHERE uid > ${toSqlLiteral(cursor)} ` : '';
    const pageSql =
      `SELECT ${fields.join(', ')} FROM ( ${source.innerSql} ) AS page ` +
      `${where}ORDER BY uid LIMIT ${remaining}`;

    let pageRows = 0;
    for await (const batch of streamQuery(connector, source.schema, pageSql, {
      timeoutMs: LAKEHOUSE_STATEMENT_TIMEOUT_MS,
      signal,
    })) {
      let text = '';
      for (const r of batch.rows) {
        text += format === 'csv' ? encodeCsvRow(fields, r) : encodeNdjsonRow(fields, r);
        cursor = String(r[0]); // last uid seen = the resume cursor
      }
      pageRows += batch.rows.length;
      total += batch.rows.length;
      if (text) yield { text, rowsInChunk: batch.rows.length };
    }

    // A short page (fewer than we asked for) means the cohort is exhausted.
    if (pageRows < remaining) break;
  }

  const sentinel =
    format === 'csv'
      ? `# complete,${total}\n`
      : `${JSON.stringify({ _complete: true, count: total })}\n`;
  yield { text: sentinel, rowsInChunk: 0, sentinel: true, totalRows: total };
}
