/**
 * Read-only CubeStore storage introspection.
 *
 * Answers "what pre-aggregations are actually MATERIALISED in CubeStore right
 * now (sealed/ready, how fresh, how big), and is a given query's rollup among
 * them" — the truth the /load probe can only infer. Talks the MySQL wire
 * protocol to CubeStore's read-only `system.*` tables (no auth on the bare
 * cluster); enabled by env so non-dev hosts that can't reach :3306 stay calm.
 *
 * CubeStore SQL quirks shaping this code: dotted `SYSTEM.TABLES` fails (lowercase
 * `system.tables`), `SUM(boolean)`/JOINs are unreliable — so we pull three flat
 * result sets and aggregate in JS. Physical table names carry a version/range
 * suffix (`<base>[batchYYYYMMDD]_<hash>_<hash>_<id>`); we group by stripped base.
 */

import mysql from 'mysql2/promise';

const TTL_MS = 30_000;
/** Schemas that hold pre-aggregations (per-game `preagg_*` + prefix model). */
const PREAGG_SCHEMA_RE = /(^preagg_)|(_pre_aggregations$)/;

export function isCubestoreIntrospectEnabled(): boolean {
  return (process.env.CUBESTORE_INTROSPECT_ENABLED ?? 'false').toLowerCase() === 'true';
}

let pool: mysql.Pool | null = null;
function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.CUBESTORE_MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.CUBESTORE_MYSQL_PORT ?? 13306),
      user: process.env.CUBESTORE_MYSQL_USER ?? 'root',
      connectionLimit: 2,
      connectTimeout: 8_000,
    });
  }
  return pool;
}

const truthy = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

/**
 * Strip Cube's physical version/range suffix to the logical pre-agg base.
 * `active_daily_dau_by_country_payer_daily_batch20260601_pgstsc44_dslie4mx_1l2maeu`
 *   → `active_daily_dau_by_country_payer_daily_batch`
 * Cube appends a trailing `_<contentVersion>_<structureVersion>_<naturalId>`
 * (3 tokens), with an optional `YYYYMMDD` partition-range stamp glued before it.
 *
 * Assumption: exactly 3 trailing version tokens. Two distinct pre-aggs whose
 * logical names differ ONLY within their last 3 underscore tokens would collapse
 * into one group — no such collision exists in the current model, but a new
 * rollup name should keep its distinguishing token outside the trailing three.
 */
export function logicalPreaggBase(tableName: string): string {
  const parts = tableName.split('_');
  const base = parts.length > 3 ? parts.slice(0, -3).join('_') : tableName;
  return base.replace(/20\d{6}$/, '');
}

export interface PreaggMaterialization {
  schema: string;
  base: string;
  tableCount: number;
  sealedCount: number;
  readyCount: number;
  partitions: number;
  activePartitions: number;
  rows: number;
  bytes: number;
  buildRangeEnd: string | null;
  sealAt: string | null;
}

export interface CubestoreStorage {
  enabled: boolean;
  generatedAt: string;
  schemas: Array<{ schema: string; preaggs: PreaggMaterialization[] }>;
  error: string | null;
}

export interface TableRow {
  id: number; table_schema: string; table_name: string;
  has_data: unknown; is_ready: unknown; sealed: unknown;
  build_range_end: string | null; seal_at: string | null;
}
export interface IndexRow { id: number; table_id: number }
export interface PartRow { index_id: number; active: unknown; main_table_row_count: unknown; file_size: unknown }

/**
 * Pure aggregation: fold the three flat `system.*` result sets into pre-aggs
 * grouped by schema → logical base. Separated from the DB call so it is unit
 * testable without a live CubeStore. Partition stats fold onto their owning
 * table via index_id → indexes.id → indexes.table_id.
 */
export function aggregateCubestoreStorage(
  tables: TableRow[],
  indexes: IndexRow[],
  parts: PartRow[],
): Array<{ schema: string; preaggs: PreaggMaterialization[] }> {
  const tableIdForIndex = new Map<number, number>();
  for (const ix of indexes) tableIdForIndex.set(num(ix.id), num(ix.table_id));

  interface PStat { partitions: number; active: number; rows: number; bytes: number }
  const partByTable = new Map<number, PStat>();
  for (const p of parts) {
    const tid = tableIdForIndex.get(num(p.index_id));
    if (tid == null) continue;
    const s = partByTable.get(tid) ?? { partitions: 0, active: 0, rows: 0, bytes: 0 };
    s.partitions += 1;
    if (truthy(p.active)) s.active += 1;
    s.rows += num(p.main_table_row_count);
    s.bytes += num(p.file_size);
    partByTable.set(tid, s);
  }

  const groups = new Map<string, PreaggMaterialization>();
  for (const t of tables) {
    if (!PREAGG_SCHEMA_RE.test(t.table_schema)) continue;
    const base = logicalPreaggBase(t.table_name);
    const key = `${t.table_schema}|${base}`;
    const g = groups.get(key) ?? {
      schema: t.table_schema, base, tableCount: 0, sealedCount: 0, readyCount: 0,
      partitions: 0, activePartitions: 0, rows: 0, bytes: 0, buildRangeEnd: null, sealAt: null,
    };
    g.tableCount += 1;
    if (truthy(t.sealed)) g.sealedCount += 1;
    if (truthy(t.is_ready)) g.readyCount += 1;
    const ps = partByTable.get(num(t.id));
    if (ps) { g.partitions += ps.partitions; g.activePartitions += ps.active; g.rows += ps.rows; g.bytes += ps.bytes; }
    if (t.build_range_end && (!g.buildRangeEnd || t.build_range_end > g.buildRangeEnd)) g.buildRangeEnd = t.build_range_end;
    if (t.seal_at && (!g.sealAt || t.seal_at > g.sealAt)) g.sealAt = t.seal_at;
    groups.set(key, g);
  }

  const bySchema = new Map<string, PreaggMaterialization[]>();
  for (const g of groups.values()) {
    const list = bySchema.get(g.schema) ?? [];
    list.push(g);
    bySchema.set(g.schema, list);
  }
  return [...bySchema.entries()]
    .map(([schema, preaggs]) => ({ schema, preaggs: preaggs.sort((a, b) => b.bytes - a.bytes) }))
    .sort((a, b) => a.schema.localeCompare(b.schema));
}

let cache: { at: number; value: CubestoreStorage } | null = null;

/** Materialised pre-aggregations grouped by schema → logical base. TTL-cached. */
export async function readCubestoreStorage(): Promise<CubestoreStorage> {
  if (!isCubestoreIntrospectEnabled()) {
    return { enabled: false, generatedAt: new Date().toISOString(), schemas: [], error: null };
  }
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  try {
    const pool = getPool();
    const [tables] = await pool.query('SELECT id, table_schema, table_name, has_data, is_ready, sealed, build_range_end, seal_at FROM system.tables');
    const [indexes] = await pool.query('SELECT id, table_id FROM system.indexes');
    const [parts] = await pool.query('SELECT index_id, active, main_table_row_count, file_size FROM system.partitions');

    const schemas = aggregateCubestoreStorage(tables as TableRow[], indexes as IndexRow[], parts as PartRow[]);
    const value: CubestoreStorage = { enabled: true, generatedAt: new Date().toISOString(), schemas, error: null };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    // Best-effort: a downed/unreachable CubeStore returns an error payload, not
    // a thrown 500 — the panel renders the reason calmly.
    return { enabled: true, generatedAt: new Date().toISOString(), schemas: [], error: (err as Error).message };
  }
}

/**
 * Find one materialised pre-agg by the table name a Cube /sql dry-run reports
 * (schema-qualified, e.g. `preagg_cfm.active_daily_dau_by_country_payer_daily_batch`).
 *
 * IMPORTANT: the dry-run already reports the LOGICAL name — no version/range
 * suffix — which is exactly what `logicalPreaggBase` derives from a PHYSICAL
 * CubeStore table name. So we match the bare dry-run name DIRECTLY against the
 * stored base; re-stripping it would chop 3 real tokens and miss every time
 * (silent all-`not-built`). Returns null when nothing matches — i.e.
 * defined-but-not-built.
 */
export async function findPreaggByTableName(tableName: string): Promise<PreaggMaterialization | null> {
  const dot = tableName.indexOf('.');
  const schema = dot > 0 ? tableName.slice(0, dot) : '';
  const bare = dot > 0 ? tableName.slice(dot + 1) : tableName;
  const storage = await readCubestoreStorage();
  if (storage.error || !storage.enabled) return null;
  for (const s of storage.schemas) {
    if (schema && s.schema !== schema) continue;
    const hit = s.preaggs.find((p) => p.base === bare);
    if (hit) return hit;
  }
  return null;
}
