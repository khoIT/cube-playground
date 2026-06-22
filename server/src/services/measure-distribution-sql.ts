/**
 * Pure SQL builders and row parsers for the bucketed histogram endpoint.
 *
 * All functions here are stateless and side-effect free — they take plain
 * values and return strings or typed objects. This makes them unit-testable
 * without any Trino connection or catalog lookup.
 *
 * Two-pass strategy:
 *   Pass 1 — approx_percentile over an ARRAY of fractions (one query) gives
 *             N-1 bucket boundary edges + p50 + p90 summary stats in one shot.
 *   Pass 2 — SUM(CASE WHEN … THEN 1 ELSE 0 END) for each bucket counts rows
 *             per bucket using the resolved edges from pass 1.
 *
 * Handles skewed distributions (whale tails) better than equal-width bins
 * because the boundaries are percentile-derived; the approximation error is
 * bounded by Trino's TDigest quantile sketch (~1%).
 */

import type { PredicateNode, IdentityMerge } from '../types/predicate-tree.js';
import { predicateToSql } from './predicate-to-sql.js';
import { buildMergedFrom } from './percentile-cutoff-resolver.js';
import type { Connector } from './trino-profiler-config.js';
import type { TrinoResult } from './trino-rest-client.js';

// ---------------------------------------------------------------------------
// Shared types (re-exported so consumers import from one place)
// ---------------------------------------------------------------------------

export interface DistributionBucket {
  lo: number;
  hi: number;
  count: number;
}

export interface DistributionSuccess {
  buckets: DistributionBucket[];
  total: number;
  p50: number;
  p90: number;
  took_ms: number;
  approx: true;
}

export interface DistributionFallback {
  buckets: null;
  reason: string;
  took_ms: number;
}

export type DistributionResult = DistributionSuccess | DistributionFallback;

export interface DistributionRequest {
  game_id: string;
  member: string;
  population_predicate?: PredicateNode;
  buckets?: number;
}

/** Injected executor seam — receives SQL + schema, returns raw Trino rows. */
export type QueryExecutor = (
  connector: Connector,
  schema: string,
  sql: string,
  timeoutMs: number,
) => Promise<TrinoResult>;

export interface DistributionDeps {
  runQuery?: QueryExecutor;
  connector?: Connector | null;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Identifier guard (defense-in-depth; physical table/column are operator-owned)
// ---------------------------------------------------------------------------

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

export function assertIdent(ident: string, what: string): string {
  if (!IDENT_RE.test(ident)) throw new Error(`measure-distribution: invalid ${what} "${ident}"`);
  return ident;
}

// ---------------------------------------------------------------------------
// WHERE clause compiler
// ---------------------------------------------------------------------------

/**
 * AND-combine the catalog's defaultPopulation with an optional request
 * predicate. Returns null when neither is present.
 *
 * The catalog's defaultPopulation (e.g. "payers only" for spend measures)
 * scopes the reference distribution to the domain where the measure is
 * meaningful. The request predicate narrows further (e.g. "country = VN").
 * Both are structured PredicateNodes compiled by the trusted predicate→SQL
 * path, never raw end-user SQL fragments.
 */
export function buildWhereClause(
  defaultPopulation: PredicateNode | null,
  requestPredicate?: PredicateNode,
): string | null {
  const parts: string[] = [];
  if (defaultPopulation) parts.push(predicateToSql(defaultPopulation));
  if (requestPredicate) parts.push(predicateToSql(requestPredicate));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return parts.map((p) => `(${p})`).join(' AND ');
}

// ---------------------------------------------------------------------------
// Pass-1 SQL: approx_percentile edges + total
// ---------------------------------------------------------------------------

/**
 * Compute the fraction array for approx_percentile. For n buckets we need
 * n-1 interior boundary fractions. p50 and p90 are appended only when they
 * are not already one of the boundary fractions (avoids duplicate array
 * entries which Trino may reject or mis-index).
 */
export function buildEdgeFractions(bucketCount: number): { fractions: number[]; p50Idx: number; p90Idx: number } {
  const fractions: number[] = [];
  for (let i = 1; i < bucketCount; i++) fractions.push(i / bucketCount);

  const summaryPs = [0.5, 0.9];
  const indices: number[] = [];
  for (const sp of summaryPs) {
    const existing = fractions.findIndex((f) => Math.abs(f - sp) < 1e-9);
    if (existing === -1) {
      indices.push(fractions.length);
      fractions.push(sp);
    } else {
      indices.push(existing);
    }
  }

  return { fractions, p50Idx: indices[0], p90Idx: indices[1] };
}

/**
 * Build the approx_percentile pass SQL: one row containing the ARRAY of
 * boundary + summary percentile values and count(*) total.
 */
export function buildEdgesSql(opts: {
  physicalTable: string;
  physicalColumn: string;
  identityMerge: IdentityMerge | null;
  where: string | null;
  bucketCount: number;
}): string {
  const { physicalTable, physicalColumn, identityMerge, where, bucketCount } = opts;
  const table = assertIdent(physicalTable, 'table');
  const col = assertIdent(physicalColumn, 'column');

  const mergeSpec = identityMerge ? { ...identityMerge, columns: [physicalColumn] } : undefined;
  const from = buildMergedFrom(table, mergeSpec);

  const { fractions } = buildEdgeFractions(bucketCount);
  const fractionsLiteral = `ARRAY[${fractions.map((f) => f.toFixed(4)).join(', ')}]`;
  const whereClause = where ? ` WHERE ${where}` : '';

  return (
    `SELECT approx_percentile(${col}, ${fractionsLiteral}) AS edges,\n` +
    `       count(*) AS total\n` +
    `FROM ${from}${whereClause}`
  );
}

// ---------------------------------------------------------------------------
// Pass-2 SQL: per-bucket counts
// ---------------------------------------------------------------------------

/**
 * Build the counting SQL using pre-computed boundary edges. Each bucket is a
 * SUM(CASE WHEN …) expression so all bucket counts are returned in one row
 * with columns b0, b1, …, b_n. The last bucket is open-ended on the right.
 */
export function buildCountsSql(opts: {
  physicalTable: string;
  physicalColumn: string;
  identityMerge: IdentityMerge | null;
  where: string | null;
  edges: number[];
}): string {
  const { physicalTable, physicalColumn, identityMerge, where, edges } = opts;
  const table = assertIdent(physicalTable, 'table');
  const col = assertIdent(physicalColumn, 'column');

  const mergeSpec = identityMerge ? { ...identityMerge, columns: [physicalColumn] } : undefined;
  const from = buildMergedFrom(table, mergeSpec);
  const whereClause = where ? ` WHERE ${where}` : '';

  if (edges.length === 0) {
    return `SELECT count(*) AS cnt FROM ${from}${whereClause}`;
  }

  const n = edges.length + 1;
  const cases: string[] = [];
  for (let i = 0; i < n; i++) {
    let cond: string;
    if (i === 0) {
      cond = `${col} <= ${edges[0]}`;
    } else if (i === n - 1) {
      cond = `${col} > ${edges[i - 1]}`;
    } else {
      cond = `${col} > ${edges[i - 1]} AND ${col} <= ${edges[i]}`;
    }
    cases.push(`  SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS b${i}`);
  }

  return `SELECT\n${cases.join(',\n')}\nFROM ${from}${whereClause}`;
}

// ---------------------------------------------------------------------------
// Row parsers
// ---------------------------------------------------------------------------

/**
 * Parse the single Trino row from the approx_percentile pass. Handles both
 * JS-array and JSON-string representations (Trino REST serializes ARRAY
 * differently depending on version and query plan).
 */
export function parseEdgesRow(
  row: unknown[],
  bucketCount: number,
): { edges: number[]; total: number; p50: number; p90: number } | null {
  if (!row || row.length < 2) return null;

  let rawEdges = row[0];
  if (typeof rawEdges === 'string') {
    try { rawEdges = JSON.parse(rawEdges); } catch { return null; }
  }
  if (!Array.isArray(rawEdges)) return null;

  const total = Number(row[1]);
  if (!Number.isFinite(total)) return null;

  const { fractions, p50Idx, p90Idx } = buildEdgeFractions(bucketCount);
  const boundaryCount = bucketCount - 1;

  const edges = rawEdges.slice(0, boundaryCount).map(Number);
  const p50 = rawEdges.length > p50Idx ? Number(rawEdges[p50Idx]) : NaN;
  const p90 = rawEdges.length > p90Idx ? Number(rawEdges[p90Idx]) : NaN;

  // Unused variable guard: fractions is used indirectly via its length to derive
  // boundaryCount above; the explicit reference here prevents a lint warning.
  void fractions.length;

  return { edges, total, p50, p90 };
}

/**
 * Parse the single Trino row from the counts pass. Columns are b0, b1, …
 * in the order edges define them.
 */
export function parseBucketRow(row: unknown[], edges: number[]): DistributionBucket[] | null {
  const n = edges.length + 1;
  if (!row || row.length < n) return null;

  const buckets: DistributionBucket[] = [];
  for (let i = 0; i < n; i++) {
    const count = Number(row[i]);
    if (!Number.isFinite(count)) return null;
    const lo = i === 0 ? -Infinity : edges[i - 1];
    const hi = i === n - 1 ? Infinity : edges[i];
    // Replace Infinity sentinels with MAX_VALUE so JSON serialization is sane.
    buckets.push({
      lo: Number.isFinite(lo) ? lo : -Number.MAX_VALUE,
      hi: Number.isFinite(hi) ? hi : Number.MAX_VALUE,
      count,
    });
  }
  return buckets;
}
