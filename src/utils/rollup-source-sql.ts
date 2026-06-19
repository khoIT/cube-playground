/**
 * Derive runnable **Trino source SQL** for a query that Cube served from a
 * pre-aggregation.
 *
 * When a query matches a rollup, Cube's generated SQL (`sqlQuery.sql()`) is
 * CubeStore dialect (backtick identifiers, `to_timestamp(...)`) against a
 * `preagg_*` table that does not exist in the source database — so it cannot be
 * pasted into a Trino editor. The `/sql` response, however, also carries the
 * rollup's own source SELECT (real source tables, Trino dialect) plus the
 * re-aggregation recipe, which lets us reconstruct an equivalent source query.
 *
 * Two outcomes:
 *  - `exact`: re-point the rollup execution query's FROM at the rollup source
 *    SELECT so it reproduces the user's exact result from source tables. Only
 *    when the re-aggregation is additive (sum/min/max/count) and nothing
 *    CubeStore-only survives translation.
 *  - `rollup-source`: otherwise return the rollup source SELECT as-is — still
 *    Trino, still real source tables, but at the rollup's full grain (the caller
 *    adds its own outer SELECT/WHERE).
 *
 * Returns `null` when the query was not pre-agg-served (the caller then uses the
 * normal source-SQL path, which is already Trino dialect).
 */
import { inlineSqlParams } from './inline-sql-params';

type SqlTuple = [string, unknown[]];

interface PreAggregationInfo {
  tableName?: string;
  preAggregationsSchema?: string;
  preAggregationId?: string;
  aggregationsColumns?: string[];
  sql?: SqlTuple;
  /** [start, end] the matched rollup partition was filtered to. */
  matchedTimeDimensionDateRange?: [string, string];
}

export interface RawSqlQuery {
  external?: boolean;
  sql?: SqlTuple;
  lambdaQueries?: Record<string, unknown>;
  preAggregations?: PreAggregationInfo[];
}

export interface RollupSourceSqlResult {
  sql: string;
  /** 'exact' = user's query rebuilt over source; 'rollup-source' = raw fallback. */
  kind: 'exact' | 'rollup-source';
  preAggregationId?: string;
}

// CubeStore-only constructs that have no Trino equivalent here. If any survive
// translation the rebuild is untrustworthy and we fall back to the source SELECT.
const CUBESTORE_ONLY = /`|\bto_timestamp\s*\(|\bmerge\s*\(|\bunmerge\s*\(|\bcardinality\s*\(|\bhll/i;
// Aggregations whose rollup partials are safe to re-aggregate (additive merge).
const ADDITIVE_AGG = /^\s*(sum|min|max|count)\s*\(/i;
// CubeStore substitutes these per-partition at build time; the rollup source
// SELECT comes back parameterized with them instead of real dates.
const SENTINEL_FROM = '__FROM_PARTITION_RANGE';
const SENTINEL_TO = '__TO_PARTITION_RANGE';

/**
 * Replace CubeStore partition-range sentinel params with the matched date range
 * so the source SELECT filters on real dates (and is valid SQL).
 */
function resolvePartitionParams(
  params: unknown[],
  range: [string, string] | undefined
): unknown[] {
  return params.map((p) => {
    if (p === SENTINEL_FROM) return range?.[0] ?? p;
    if (p === SENTINEL_TO) return range?.[1] ?? p;
    return p;
  });
}

/**
 * Translate a CubeStore execution SQL string to Trino dialect — identifier
 * quoting and the time-literal predicate function. String-level only; callers
 * must verify no CubeStore-only construct survives (see CUBESTORE_ONLY).
 */
function cubestoreToTrino(sql: string): string {
  return sql
    .replace(/`/g, '"')
    .replace(/\bto_timestamp\s*\(/gi, 'from_iso8601_timestamp(');
}

export function deriveTrinoSourceSql(
  raw: RawSqlQuery | undefined | null
): RollupSourceSqlResult | null {
  if (!raw?.external) return null; // not served from a pre-aggregation

  const pa = raw.preAggregations?.[0];
  const paSql = pa?.sql;
  if (!pa || !Array.isArray(paSql)) return null;

  // Source SELECT is already Trino dialect against real tables. Its params are
  // CubeStore partition sentinels — resolve them to the matched date range
  // before inlining, else the SQL filters on bogus literals.
  const sourceParams = resolvePartitionParams(paSql[1], pa.matchedTimeDimensionDateRange);
  const sourceSelect = inlineSqlParams(paSql[0], sourceParams);
  // If a sentinel could not be resolved the SQL would be invalid — bail so the
  // caller keeps the (truthful) generated SQL rather than emitting broken SQL.
  if (sourceSelect.includes(SENTINEL_FROM) || sourceSelect.includes(SENTINEL_TO)) {
    return null;
  }
  const fallback: RollupSourceSqlResult = {
    sql: sourceSelect,
    kind: 'rollup-source',
    preAggregationId: pa.preAggregationId,
  };

  const exec = raw.sql;
  const tableName = pa.tableName;
  const aggCols = pa.aggregationsColumns ?? [];

  const canRebuildExact =
    (raw.preAggregations?.length ?? 0) === 1 &&
    Object.keys(raw.lambdaQueries ?? {}).length === 0 &&
    Array.isArray(exec) &&
    !!tableName &&
    aggCols.length > 0 &&
    aggCols.every((c) => ADDITIVE_AGG.test(c));

  if (!canRebuildExact || !exec || !tableName) return fallback;

  // Inline exec params, translate dialect, then re-point FROM <rollupTable> at
  // the rollup source SELECT as a subquery (preserving the table alias).
  let rebuilt = cubestoreToTrino(inlineSqlParams(exec[0], exec[1]));
  if (!rebuilt.includes(tableName)) return fallback; // FROM not where we expect
  rebuilt = rebuilt.split(tableName).join(`(\n${sourceSelect}\n)`);

  // Safety net: the rollup must be fully repointed and nothing CubeStore-only
  // may survive, else the SQL would not run (or run wrong) in Trino.
  const schema = pa.preAggregationsSchema;
  if (CUBESTORE_ONLY.test(rebuilt)) return fallback;
  if (schema && rebuilt.includes(schema)) return fallback;
  if (/\bpreagg_/i.test(rebuilt)) return fallback;

  return { sql: rebuilt, kind: 'exact', preAggregationId: pa.preAggregationId };
}

/** A leading SQL comment describing a derived source-SQL result (paste-safe). */
export function sourceSqlNote(result: RollupSourceSqlResult): string {
  const id = result.preAggregationId ? ` "${result.preAggregationId}"` : '';
  return result.kind === 'exact'
    ? `-- Trino source SQL — rebuilt from rollup${id} over source tables (query was served from a pre-aggregation).`
    : `-- Trino source SQL at rollup grain — rollup${id} could not be exactly rebuilt; add your own SELECT/WHERE (query was served from a pre-aggregation).`;
}
