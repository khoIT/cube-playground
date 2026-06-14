/**
 * load-cube-rows — execute a Cube /load query and return rows, with the same
 * cache + normalization behavior preview_cube_query has always used.
 *
 * Extracted from preview-cube-query so other callers (the emit_query_artifact
 * deterministic-chart fallback) can share this load path. preview_cube_query
 * now delegates here; behavior is unchanged. Note the cache key includes the
 * row limit, so preview (≤50) and the fallback (MAX_ROWS=100) don't necessarily
 * share a cached entry — each caller still benefits from repeat-call caching.
 */

import { config } from '../config.js';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { getCachedLoad, putCachedLoad } from '../cache/load-cache-adapter.js';
import { normalizeCubeDateRanges } from '../tools/normalize-cube-date-range.js';
import type { CubeQuerySchema } from '../tools/preview-cube-query.js';
import type { z } from 'zod';
import type { ToolContext } from '../types.js';

type CubeQuery = z.infer<typeof CubeQuerySchema>;
type CubeRow = Record<string, string | number>;

/**
 * Run a Cube /load query and return rows (no pre-flight ref guard — callers
 * validate against /meta themselves where needed). Normalizes relative date
 * ranges, applies `maxRows` as the query limit, and reuses the load cache.
 * Empty results are never cached (transient mid-rebuild states must not freeze).
 */
export async function loadCubeRows(
  rawQuery: CubeQuery,
  ctx: ToolContext,
  opts: { maxRows: number },
): Promise<CubeRow[]> {
  // Convert calendar-aligned "last N week/month/quarter/year" strings to
  // rolling [ISO, ISO] tuples before Cube parses them (idempotent on tuples).
  const normalizedTds = normalizeCubeDateRanges(rawQuery.timeDimensions);
  const query = { ...rawQuery, timeDimensions: normalizedTds, limit: opts.maxRows };

  // Cache key includes cube_meta_hash so schema changes invalidate entries.
  // Skip silently when there's no db handle on ctx (unit tests).
  const metaHash = await cubeMetaCache.getMetaVersion(ctx.gameId, ctx.workspace).catch(() => null);
  if (ctx.db) {
    const cached = getCachedLoad(ctx.db, { query, gameId: ctx.gameId, metaHash });
    if (cached) return cached.slice(0, opts.maxRows);
  }

  // Route through the workspace-aware Fastify proxy — it resolves auth + base
  // URL from the X-Cube-Workspace header server-side.
  const url = `${config.serverBaseUrl}/cube-api/v1/load`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Cube-Workspace': ctx.workspace,
      'X-Cube-Game': ctx.gameId,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cube /load failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: CubeRow[] };
  const rows = data?.data ?? [];

  // Real results cache; empty results don't (almost always transient — caching
  // would freeze a "no data" state for the cache TTL).
  if (ctx.db && rows.length > 0) {
    putCachedLoad(ctx.db, { query, gameId: ctx.gameId, metaHash, rows });
  }

  return rows.slice(0, opts.maxRows);
}
