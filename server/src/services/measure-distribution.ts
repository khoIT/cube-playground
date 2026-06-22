/**
 * Executor for the bucketed histogram endpoint (POST /api/distribution).
 *
 * Orchestrates two Trino passes (edges then counts) against the per-user
 * grain of a catalogued measure. The SQL builders and row parsers live in
 * measure-distribution-sql.ts so this file stays focused on the async
 * control flow: catalog lookup → connector resolution → two-pass execution
 * → graceful fallback on any failure.
 *
 * NEVER throws — every failure path returns { buckets: null, reason } so the
 * UI can fall back to a plain numeric cutoff input without a 500.
 */

import { getSegmentableMeasures } from './segmentable-measures-catalog.js';
import { schemaForGame, canonicalGameId } from './trino-profiler-config.js';
import {
  buildWhereClause,
  buildEdgesSql,
  buildCountsSql,
  parseEdgesRow,
  parseBucketRow,
} from './measure-distribution-sql.js';

// Re-export all shared types so consumers import from one place.
export type {
  DistributionBucket,
  DistributionSuccess,
  DistributionFallback,
  DistributionResult,
  DistributionRequest,
  QueryExecutor,
  DistributionDeps,
} from './measure-distribution-sql.js';

import type {
  DistributionRequest,
  DistributionResult,
  DistributionFallback,
  QueryExecutor,
  DistributionDeps,
} from './measure-distribution-sql.js';

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Compute a bucketed histogram of a per-user measure over an optional
 * population predicate.
 *
 * Security: the `member` field is resolved through the segmentable-measures
 * catalog which is the allowlist of valid Trino table/column targets. A
 * member not in the catalog returns { buckets: null, reason:
 * "measure_not_segmentable" } — the query never reaches Trino.
 */
export async function computeDistribution(
  req: DistributionRequest,
  deps: DistributionDeps = {},
): Promise<DistributionResult> {
  const start = Date.now();
  const bucketCount = req.buckets && req.buckets > 1 && req.buckets <= 100 ? req.buckets : 10;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function fallback(reason: string): DistributionFallback {
    return { buckets: null, reason, took_ms: Date.now() - start };
  }

  // -------------------------------------------------------------------------
  // 1. Resolve Trino connector.
  //    deps.connector === undefined  → production path (env-resolved)
  //    deps.connector === null       → caller explicitly signals "no connector"
  //    deps.connector set            → injected (tests / specific callers)
  // -------------------------------------------------------------------------
  let connector = deps.connector !== undefined ? deps.connector : undefined;
  if (connector === undefined) {
    try {
      const { resolveCsTrinoConnector } = await import('../lakehouse/cs-trino-connector.js');
      connector = resolveCsTrinoConnector();
    } catch {
      return fallback('no_connector');
    }
  }
  if (!connector) return fallback('no_connector');

  // -------------------------------------------------------------------------
  // 2. Catalog lookup — also the security allowlist for Trino targets.
  // -------------------------------------------------------------------------
  const measures = getSegmentableMeasures(req.game_id);
  const entry =
    measures.find((m) => m.dimension === req.member) ??
    measures.find((m) => m.physicalColumn === req.member.split('.').pop()) ??
    null;

  if (!entry) return fallback('measure_not_segmentable');

  // -------------------------------------------------------------------------
  // 3. Derive Trino session schema. Fully-qualified names in the SQL work
  //    regardless, but the session schema is required by the Trino protocol.
  // -------------------------------------------------------------------------
  const schema =
    schemaForGame(canonicalGameId(req.game_id)) ??
    entry.physicalTable.split('.')[0] ??
    '';

  // -------------------------------------------------------------------------
  // 4. Compile WHERE clause (defaultPopulation AND request predicate).
  // -------------------------------------------------------------------------
  let whereClause: string | null;
  try {
    whereClause = buildWhereClause(entry.defaultPopulation, req.population_predicate);
  } catch (err) {
    return fallback(`predicate_compile_error: ${(err as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // 5. Two-pass histogram execution.
  // -------------------------------------------------------------------------
  const execFn: QueryExecutor =
    deps.runQuery ??
    (async (c, s, sql, tm) => {
      const { runQuery } = await import('./trino-rest-client.js');
      return runQuery(c, s, sql, tm);
    });

  try {
    // Pass 1: approx_percentile to get bucket boundary edges + summary stats.
    const edgesSql = buildEdgesSql({
      physicalTable: entry.physicalTable,
      physicalColumn: entry.physicalColumn,
      identityMerge: entry.identityMerge,
      where: whereClause,
      bucketCount,
    });

    const edgesResult = await execFn(connector, schema, edgesSql, timeoutMs);
    const firstRow = edgesResult.rows?.[0];
    if (!firstRow) return fallback('no_data');

    const parsed = parseEdgesRow(firstRow, bucketCount);
    if (!parsed) return fallback('parse_error');

    const { edges, total, p50, p90 } = parsed;

    // Empty population: return an explicit empty histogram so the UI knows
    // there is no data (not a query failure).
    if (total === 0) {
      return { buckets: [], total: 0, p50: 0, p90: 0, took_ms: Date.now() - start, approx: true };
    }

    // Collapse duplicate edges (flat distributions — all users share the same
    // value — would produce identical boundary points that confuse the UI).
    // Drop non-finite edges first: approx_percentile can return null on a sparse
    // slot, which would otherwise carry NaN into the pass-2 `col > NaN` SQL.
    const uniqueEdges = [...new Set(edges.filter((e) => Number.isFinite(e)))].sort((a, b) => a - b);

    // Guard against the second pass timing out independently.
    const remainingMs = timeoutMs - (Date.now() - start);
    if (remainingMs <= 0) return fallback('timeout');

    // Pass 2: count rows per bucket using the resolved edges.
    const countsSql = buildCountsSql({
      physicalTable: entry.physicalTable,
      physicalColumn: entry.physicalColumn,
      identityMerge: entry.identityMerge,
      where: whereClause,
      edges: uniqueEdges,
    });

    const countsResult = await execFn(connector, schema, countsSql, remainingMs);
    const countsRow = countsResult.rows?.[0];
    if (!countsRow) return fallback('counts_empty');

    const buckets = parseBucketRow(countsRow, uniqueEdges);
    if (!buckets) return fallback('counts_parse_error');

    return {
      buckets,
      total,
      p50: Number.isFinite(p50) ? p50 : 0,
      p90: Number.isFinite(p90) ? p90 : 0,
      took_ms: Date.now() - start,
      approx: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes('timed out') || msg.includes('AbortError');
    return fallback(isTimeout ? 'timeout' : `query_error: ${msg}`);
  }
}
