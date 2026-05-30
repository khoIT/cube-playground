/**
 * ANSI information_schema profiler — covers the SQL-over-host warehouse family
 * (Postgres / MySQL / Redshift / ClickHouse …) that share `information_schema`.
 *
 * Differs from the Trino profiler only in dialect: ANSI uses `count(distinct …)`
 * for cardinality (Trino has `approx_distinct`). The profiling/mapping logic is
 * identical in spirit and bounded by the same PROFILER_CAPS.
 *
 * Driver-agnostic by design: the actual wire protocol is injected as a
 * `SqlRunner` produced by a registered factory (keyed by driver type). No DB
 * driver is bundled here, so the mapping logic is unit-testable with a fake
 * runner, and a real driver (e.g. `pg`) is wired by calling
 * `registerSqlRunnerFactory` from an adapter module — without touching dispatch.
 * Until a factory is registered for a driver type, `createInformationSchemaProfiler`
 * returns null and the caller surfaces an honest "driver not wired" 501.
 */

import type { ColumnMeta, TableMeta, ColumnProfile, TableProfile } from '../types/raw-schema.js';
import { PROFILER_CAPS, type Connector } from './trino-profiler-config.js';
import type { Profiler } from './profiler-interface.js';

/** Executes one read-only SQL statement, bound to a specific connector. */
export type SqlRunner = (sql: string) => Promise<{ columns: { name: string }[]; rows: unknown[][] }>;
export type SqlRunnerFactory = (connector: Connector) => SqlRunner | null;

const factories = new Map<string, SqlRunnerFactory>();

/** Register a wire-protocol runner for a driver type (e.g. 'postgres' → pg). */
export function registerSqlRunnerFactory(driverType: string, factory: SqlRunnerFactory): void {
  factories.set(driverType, factory);
}

/** Test-only: drop a registered factory. */
export function __clearSqlRunnerFactories(): void {
  factories.clear();
}

const RANGEABLE = /^(bigint|int|integer|smallint|tinyint|double|real|decimal|numeric|float|date|timestamp|time)/i;

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}
function cell(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

export async function ansiListTables(run: SqlRunner, schema: string): Promise<TableMeta[]> {
  const sql = `
    SELECT table_name, column_name, data_type, ordinal_position, is_nullable
    FROM information_schema.columns
    WHERE table_schema = '${schema.replace(/'/g, "''")}'
    ORDER BY table_name, ordinal_position`;
  const { rows } = await run(sql);
  const byTable = new Map<string, ColumnMeta[]>();
  for (const r of rows) {
    const table = String(r[0]);
    const list = byTable.get(table) ?? [];
    list.push({
      name: String(r[1]),
      dataType: String(r[2]),
      position: Number(r[3]),
      nullable: String(r[4]).toUpperCase() === 'YES',
    });
    byTable.set(table, list);
  }
  return [...byTable.entries()].map(([table, columns]) => ({ schema, table, columns }));
}

function statsSql(schema: string, table: string, cols: ColumnMeta[]): string {
  const parts: string[] = ['count(*) AS rc'];
  for (const c of cols) {
    const q = quoteIdent(c.name);
    parts.push(`count(${q}) AS nn_${c.position}`);
    parts.push(`count(DISTINCT ${q}) AS ad_${c.position}`);
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

async function sampleColumn(run: SqlRunner, schema: string, table: string, col: ColumnMeta): Promise<string[]> {
  const q = quoteIdent(col.name);
  const sql = `SELECT DISTINCT CAST(${q} AS VARCHAR) AS v
    FROM ${quoteIdent(schema)}.${quoteIdent(table)}
    WHERE ${q} IS NOT NULL
    LIMIT ${PROFILER_CAPS.sampleDistinctLimit}`;
  try {
    const { rows } = await run(sql);
    return rows.map((r) => String(r[0]));
  } catch {
    return [];
  }
}

export async function ansiProfileTable(run: SqlRunner, schema: string, table: string): Promise<TableProfile> {
  const tables = await ansiListTables(run, schema);
  const meta = tables.find((t) => t.table === table);
  if (!meta) throw new Error(`table "${table}" not found in schema "${schema}"`);

  const cols = meta.columns.slice(0, PROFILER_CAPS.maxColumnsPerTable);
  const { columns: outCols, rows } = await run(statsSql(schema, table, cols));
  const row = rows[0] ?? [];

  const idx = new Map<string, number>();
  outCols.forEach((c, i) => idx.set(c.name.toLowerCase(), i));
  const rowCount = Number(row[idx.get('rc') ?? 0] ?? 0);

  const profiles: ColumnProfile[] = [];
  for (const c of cols) {
    const nonNull = Number(row[idx.get(`nn_${c.position}`) ?? -1] ?? 0);
    const approxDistinct = Number(row[idx.get(`ad_${c.position}`) ?? -1] ?? 0);
    const nullPct = rowCount > 0 ? (rowCount - nonNull) / rowCount : 0;
    const isUnique = rowCount > 0 && approxDistinct / rowCount >= PROFILER_CAPS.uniqueRatio;
    const sampleValues = await sampleColumn(run, schema, table, c);
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

/**
 * Build a Profiler for a connector if a SQL runner factory is registered for its
 * driver type; otherwise null (caller → "driver not wired"). The returned
 * Profiler ignores its `connector` arg — the runner is already bound to it.
 */
export function createInformationSchemaProfiler(connector: Connector): Profiler | null {
  const factory = factories.get(connector.sourceType);
  const run = factory ? factory(connector) : null;
  if (!run) return null;
  return {
    listTables: (_c, schema) => ansiListTables(run, schema),
    profileTable: (_c, schema, table) => ansiProfileTable(run, schema, table),
  };
}
