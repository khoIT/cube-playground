/**
 * Preview service — translate a predicate tree to a Cube query, fire both
 * /load (count) and /sql in parallel, return { estimated_count, cube_query,
 * sql_preview, took_ms }. Results are cached for 60s keyed by tree+cube hash.
 *
 * The /load query mirrors the refresh job's size-phase methodology
 * (dimensions:[identity] + total:true → distinct UID count) so the live editor
 * estimate matches the persisted segment size. When no identity mapping
 * exists we fall back to `<primaryCube>.count` (typically COUNT(*)) so the
 * preview still returns a number, even if approximate.
 */

import { createHash } from 'node:crypto';
import { load, sql } from './cube-client.js';
import { treeToCubeFilters } from './translator.js';
import { resolveIdentityField } from './resolve-identity-field.js';
import type { PredicateNode } from '../types/predicate-tree.js';

export interface PreviewResult {
  estimated_count: number | null;
  cube_query: unknown;
  sql_preview: string | null;
  took_ms: number;
  cached: boolean;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { result: PreviewResult; storedAt: number }>();

function cacheKey(tree: PredicateNode, primaryCube: string, cubeSegments: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ tree, primaryCube, cubeSegments }))
    .digest('hex');
}

// Cube /load with `total: true` returns the true distinct-row count in the
// `total` annotation (top-level on /load, nested under `results[]` on /batch).
function extractTotal(loadResult: unknown): number | null {
  const r = loadResult as { total?: number; results?: Array<{ total?: number }> };
  const t = r.total ?? r.results?.[0]?.total;
  return typeof t === 'number' ? t : null;
}

// Fallback path: read a measure value from the single returned row.
function extractMeasure(loadResult: unknown, measure: string): number | null {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  const row = r.data?.[0] ?? r.results?.[0]?.data?.[0];
  if (!row) return null;
  const v = row[measure];
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractSql(sqlResult: unknown): string | null {
  const r = sqlResult as { sql?: { sql?: [string, unknown[]] | string } };
  const inner = r.sql?.sql;
  if (Array.isArray(inner)) return String(inner[0]);
  if (typeof inner === 'string') return inner;
  return null;
}

export async function preview(
  tree: PredicateNode,
  primaryCube: string,
  /** Cube-level segments scoping the cohort — carried so the editor's live
   *  count matches the membership the refresh job will materialize. */
  cubeSegments: string[] = [],
): Promise<PreviewResult> {
  const key = cacheKey(tree, primaryCube, cubeSegments);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) {
    return { ...hit.result, cached: true };
  }

  const t0 = Date.now();
  const filters = treeToCubeFilters(tree);
  const identity = await resolveIdentityField(primaryCube);

  // Identity-distinct path mirrors refresh-segment so the editor preview
  // matches the persisted uid_count once the segment refreshes.
  const segments = cubeSegments.length > 0 ? { segments: cubeSegments } : {};
  const cubeQuery = identity
    ? { dimensions: [identity], filters, ...segments, limit: 1, total: true }
    : { measures: [`${primaryCube}.count`], filters, ...segments, limit: 1 };

  const [loadRes, sqlRes] = await Promise.allSettled([
    load(cubeQuery),
    sql(cubeQuery),
  ]);

  let estimated: number | null = null;
  if (loadRes.status === 'fulfilled') {
    estimated = identity
      ? extractTotal(loadRes.value)
      : extractMeasure(loadRes.value, `${primaryCube}.count`);
  }

  const result: PreviewResult = {
    estimated_count: estimated,
    cube_query: cubeQuery,
    sql_preview: sqlRes.status === 'fulfilled' ? extractSql(sqlRes.value) : null,
    took_ms: Date.now() - t0,
    cached: false,
  };

  cache.set(key, { result, storedAt: Date.now() });
  return result;
}

/** Reset cache — exposed for tests. */
export function __resetPreviewCache(): void {
  cache.clear();
}
