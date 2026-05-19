/**
 * Preview service — translate a predicate tree to a Cube query, fire both
 * /load (count) and /sql in parallel, return { estimated_count, cube_query,
 * sql_preview, took_ms }. Results are cached for 60s keyed by tree+cube hash.
 */

import { createHash } from 'node:crypto';
import { load, sql } from './cube-client.js';
import { treeToCubeFilters } from './translator.js';
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

function cacheKey(tree: PredicateNode, primaryCube: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ tree, primaryCube }))
    .digest('hex');
}

function extractCount(loadResult: unknown, measure: string): number | null {
  const r = loadResult as { results?: Array<{ data?: Array<Record<string, unknown>> }> };
  const row = r.results?.[0]?.data?.[0];
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
): Promise<PreviewResult> {
  const key = cacheKey(tree, primaryCube);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) {
    return { ...hit.result, cached: true };
  }

  const t0 = Date.now();
  const measure = `${primaryCube}.count`;
  const filters = treeToCubeFilters(tree);
  const cubeQuery = { measures: [measure], filters, limit: 1 };

  const [loadRes, sqlRes] = await Promise.allSettled([
    load(cubeQuery),
    sql(cubeQuery),
  ]);

  const result: PreviewResult = {
    estimated_count: loadRes.status === 'fulfilled' ? extractCount(loadRes.value, measure) : null,
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
