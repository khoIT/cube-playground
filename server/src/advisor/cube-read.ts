/**
 * Provenance-recording Cube query helper for the advisor lenses.
 *
 * Every lens read must produce a PlaygroundLink alongside its rows so the Advisor
 * UI can reconstruct the evidence query for drill-through without re-executing.
 *
 * The reader function is injected — the default uses loadWithCtx from the Cube
 * client, but tests stub it with a pure in-memory fixture so no live Cube
 * connection is required.
 */

import type { WorkspaceCtx } from '../services/cube-client.js';
import type { PlaygroundLink } from './diagnosis-types.js';

/** Shape of a Cube /load query (subset used by advisor lenses). */
export interface AdvisorQuery {
  measures?: string[];
  dimensions?: string[];
  filters?: unknown[];
  timeDimensions?: Array<{
    dimension: string;
    granularity?: string;
    dateRange?: unknown;
  }>;
  order?: Record<string, string>;
  limit?: number;
}

/** A row returned from Cube /load. */
export type CubeRow = Record<string, unknown>;

/**
 * Function that executes a Cube query and returns data rows.
 * Default implementation calls loadWithCtx; tests inject a stub.
 */
export type CubeReaderFn = (query: AdvisorQuery, ctx: WorkspaceCtx) => Promise<CubeRow[]>;

/** Result from readWithProvenance — rows + the evidence link. */
export interface AdvisorReadResult {
  rows: CubeRow[];
  provenance: PlaygroundLink;
}

/**
 * Execute a Cube query and attach provenance.
 *
 * @param query     The Cube query to run.
 * @param ctx       Workspace context (base URL + token).
 * @param sourceLabel Human-readable source label for display in Playground.
 * @param reader    Injected reader; defaults to the live Cube loadWithCtx.
 */
export async function readWithProvenance(
  query: AdvisorQuery,
  ctx: WorkspaceCtx,
  sourceLabel: string,
  reader: CubeReaderFn = defaultCubeReader,
): Promise<AdvisorReadResult> {
  const rows = await reader(query, ctx);

  const provenance: PlaygroundLink = {
    cube: extractPrimaryCube(query),
    measures: query.measures ?? [],
    dimensions: query.dimensions,
    filters: query.filters,
    source: sourceLabel,
    rows: rows.length,
  };

  return { rows, provenance };
}

/**
 * Per-query budget for advisor reads. Larger than the 15s interactive fetch cap
 * so a cold warehouse can warm its pre-aggregation within Cube's continue-wait
 * window instead of aborting client-side — one held tool call replaces several
 * failed agent retries that would otherwise drain the turn budget. Bounded well
 * under the overall turn timeout so a single query can't starve the rest.
 */
const ADVISOR_QUERY_TIMEOUT_MS = (() => {
  const raw = process.env.ADVISOR_CUBE_QUERY_TIMEOUT_MS;
  const n = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
})();

/**
 * Default reader — polls Cube's continue-wait window so a cold pre-agg warms
 * rather than hard-failing at the 15s interactive cap, then extracts the data
 * array. Throws on Cube errors (callers handle with try/catch and emit
 * verdict='inconclusive').
 */
async function defaultCubeReader(query: AdvisorQuery, ctx: WorkspaceCtx): Promise<CubeRow[]> {
  const { loadWithContinueWait } = await import('../services/load-with-continue-wait.js');
  const res = (await loadWithContinueWait(query, undefined, ADVISOR_QUERY_TIMEOUT_MS, ctx)) as {
    data?: CubeRow[];
  };
  return res.data ?? [];
}

/**
 * Extract the primary cube name from a query's first measure.
 * e.g. "mf_users.paying_users" → "mf_users".
 * Returns undefined when no measures present.
 */
function extractPrimaryCube(query: AdvisorQuery): string | undefined {
  const first = query.measures?.[0] ?? query.dimensions?.[0];
  if (!first) return undefined;
  const dot = first.indexOf('.');
  return dot >= 0 ? first.slice(0, dot) : undefined;
}

/**
 * Convenience: pull a single numeric value from the first row of a result.
 * Returns null when the row or key is absent.
 */
export function extractScalar(rows: CubeRow[], key: string): number | null {
  const raw = rows[0]?.[key];
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) ? n : null;
}
