/**
 * Trino schema profiler — the onboarding pipeline's first line to the warehouse.
 *
 * `listTables(connector, schema)` enumerates a schema's tables + columns via
 * `information_schema`. `profileTable(connector, schema, table)` runs ONE
 * bounded aggregate query per table (count, per-column approx_distinct / null
 * count / min / max) plus one small sampled distinct-value query per column.
 *
 * Read-only by construction: only SELECTs against `information_schema` and the
 * target table are ever issued. Bounded by `PROFILER_CAPS`. Credentials are
 * redacted by the underlying REST client and never returned to callers.
 */

import type { ColumnMeta, TableMeta, ColumnProfile, TableProfile } from '../types/raw-schema.js';
import { runQuery } from './trino-rest-client.js';
import { getConnector, PROFILER_CAPS, type Connector } from './trino-profiler-config.js';

/** Trino types that support MIN/MAX + are worth ranging. */
const RANGEABLE = /^(bigint|integer|smallint|tinyint|double|real|decimal|date|timestamp|time)/i;
/** Trino types that read as numeric measures. */
const NUMERIC = /^(bigint|integer|smallint|tinyint|double|real|decimal)/i;

function quoteIdent(id: string): string {
  // Defensive: identifiers come from information_schema (server-derived), but
  // double any embedded quote so a pathological column name can't break out.
  return `"${id.replace(/"/g, '""')}"`;
}

function cell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

/** List tables + columns in a schema. */
export async function listTables(connector: Connector, schema: string): Promise<TableMeta[]> {
  const sql = `
    SELECT table_name, column_name, data_type, ordinal_position, is_nullable
    FROM information_schema.columns
    WHERE table_schema = '${schema.replace(/'/g, "''")}'
    ORDER BY table_name, ordinal_position`;
  const { rows } = await runQuery(connector, schema, sql);

  const byTable = new Map<string, ColumnMeta[]>();
  for (const r of rows) {
    const table = String(r[0]);
    const col: ColumnMeta = {
      name: String(r[1]),
      dataType: String(r[2]),
      position: Number(r[3]),
      nullable: String(r[4]).toUpperCase() === 'YES',
    };
    const list = byTable.get(table) ?? [];
    list.push(col);
    byTable.set(table, list);
  }

  return [...byTable.entries()].map(([table, columns]) => ({ schema, table, columns }));
}

/**
 * Build the single bounded aggregate query: one row of
 * [count(*), per-col count(col), per-col approx_distinct(col), min, max].
 */
function statsSql(schema: string, table: string, cols: ColumnMeta[]): string {
  const parts: string[] = ['count(*) AS rc'];
  for (const c of cols) {
    const q = quoteIdent(c.name);
    parts.push(`count(${q}) AS nn_${c.position}`);
    parts.push(`approx_distinct(${q}) AS ad_${c.position}`);
    if (RANGEABLE.test(c.dataType)) {
      parts.push(`CAST(min(${q}) AS VARCHAR) AS mn_${c.position}`);
      parts.push(`CAST(max(${q}) AS VARCHAR) AS mx_${c.position}`);
    } else {
      parts.push(`NULL AS mn_${c.position}`);
      parts.push(`NULL AS mx_${c.position}`);
    }
  }
  return `SELECT ${parts.join(', ')} FROM ${quoteIdent(schema)}.${quoteIdent(table)}`;
}

/** One small distinct-value sample per column (bounded by sampleDistinctLimit). */
async function sampleColumn(
  connector: Connector,
  schema: string,
  table: string,
  col: ColumnMeta,
): Promise<string[]> {
  const q = quoteIdent(col.name);
  const sql = `SELECT DISTINCT CAST(${q} AS VARCHAR) AS v
    FROM ${quoteIdent(schema)}.${quoteIdent(table)}
    WHERE ${q} IS NOT NULL
    LIMIT ${PROFILER_CAPS.sampleDistinctLimit}`;
  try {
    const { rows } = await runQuery(connector, schema, sql);
    return rows.map((r) => String(r[0]));
  } catch {
    return []; // sampling is best-effort; never fail the whole profile on it
  }
}

/** Profile one table — bounded aggregate stats + per-column samples. */
export async function profileTable(
  connector: Connector,
  schema: string,
  table: string,
): Promise<TableProfile> {
  const tables = await listTables(connector, schema);
  const meta = tables.find((t) => t.table === table);
  if (!meta) throw new Error(`table "${table}" not found in schema "${schema}"`);

  const cols = meta.columns.slice(0, PROFILER_CAPS.maxColumnsPerTable);
  const { columns: outCols, rows } = await runQuery(connector, schema, statsSql(schema, table, cols));
  const row = rows[0] ?? [];

  // Map result columns by alias so ordering changes don't misalign values.
  const idx = new Map<string, number>();
  outCols.forEach((c, i) => idx.set(c.name.toLowerCase(), i));
  const rowCount = Number(row[idx.get('rc') ?? 0] ?? 0);

  const profiles: ColumnProfile[] = [];
  for (const c of cols) {
    const nonNull = Number(row[idx.get(`nn_${c.position}`) ?? -1] ?? 0);
    const approxDistinct = Number(row[idx.get(`ad_${c.position}`) ?? -1] ?? 0);
    const nullPct = rowCount > 0 ? (rowCount - nonNull) / rowCount : 0;
    const isUnique = rowCount > 0 && approxDistinct / rowCount >= PROFILER_CAPS.uniqueRatio;
    const sampleValues = await sampleColumn(connector, schema, table, c);
    profiles.push({
      name: c.name,
      dataType: c.dataType,
      nullPct,
      approxDistinct,
      rowCount,
      isUnique,
      min: cell(row[idx.get(`mn_${c.position}`) ?? -1]),
      max: cell(row[idx.get(`mx_${c.position}`) ?? -1]),
      sampleValues,
    });
  }

  return { schema, table, rowCount, columns: profiles };
}

/** Convenience: resolve a connector by id then profile. Throws if unconfigured. */
export async function profileWithConnector(
  connectorId: string | null,
  schema: string,
  table: string,
): Promise<TableProfile> {
  const connector = getConnector(connectorId);
  if (!connector) throw new Error('profiler-not-configured');
  return profileTable(connector, schema, table);
}

export { NUMERIC, RANGEABLE };
