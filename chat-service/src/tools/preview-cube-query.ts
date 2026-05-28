/**
 * Tool: preview_cube_query
 * Runs a Cube /load query and returns up to N rows (hard cap: 50).
 * Lets the agent sanity-check the query shape before emitting an artifact.
 *
 * Pre-flight ref guard: validates each measure/dimension/timeDimension
 * against /meta and refuses to call Cube when any are missing. The LLM
 * relays the structured error to the user (who can ask to retry with
 * `force: true` to bypass and surface the raw Cube UserError).
 */

import { z } from 'zod';
import { config } from '../config.js';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { getCachedLoad, putCachedLoad } from '../cache/load-cache-adapter.js';
import { normalizeCubeDateRanges } from './normalize-cube-date-range.js';
import type { ToolContext } from '../types.js';

export const name = 'preview_cube_query';
export const description =
  'Run a Cube query and return sample rows (max 50). ' +
  'Use this to validate the query shape before calling emit_query_artifact. ' +
  'If any measure/dimension is missing from /meta, the call is blocked with ' +
  'a structured metric_draft error unless `force: true` is set.';

// Zod schema for a Cube query — the shape the LLM fills in
const CubeFilterSchema = z.object({
  member: z.string().optional(),
  dimension: z.string().optional(),
  operator: z.string(),
  values: z.array(z.string()).optional(),
});

const TimeDimensionSchema = z.object({
  dimension: z.string(),
  granularity: z
    .enum(['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'])
    .optional(),
  dateRange: z.union([z.string(), z.tuple([z.string(), z.string()])]).optional(),
});

export const CubeQuerySchema = z.object({
  measures: z.array(z.string()).optional(),
  dimensions: z.array(z.string()).optional(),
  timeDimensions: z.array(TimeDimensionSchema).optional(),
  filters: z.array(CubeFilterSchema).optional(),
  order: z.record(z.string(), z.enum(['asc', 'desc'])).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  segments: z.array(z.string()).optional(),
});

export const inputSchema = {
  query: CubeQuerySchema,
  limit: z.number().int().min(1).max(50).default(10),
  force: z
    .boolean()
    .optional()
    .describe('Set true to bypass the pre-flight ref guard and run the query anyway.'),
};

const MAX_LIMIT = 50;

type OkResult = { rows: unknown[]; rowCount: number; warnings: string[] };
type MetricDraftResult = {
  ok: false;
  error: 'metric_draft';
  missingRefs: string[];
  hint: string;
};

function collectQueryRefs(query: z.infer<typeof CubeQuerySchema>): string[] {
  const refs: string[] = [];
  for (const m of query.measures ?? []) refs.push(m);
  for (const d of query.dimensions ?? []) refs.push(d);
  for (const td of query.timeDimensions ?? []) refs.push(td.dimension);
  return refs;
}

export async function handler(
  args: { query: z.infer<typeof CubeQuerySchema>; limit?: number; force?: boolean },
  ctx: ToolContext,
): Promise<OkResult | MetricDraftResult> {
  if (!args.force) {
    const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
    const known = cubeMetaCache.extractMemberNames(meta);
    const missingRefs = collectQueryRefs(args.query).filter((r) => !known.has(r));
    if (missingRefs.length > 0) {
      return {
        ok: false,
        error: 'metric_draft',
        missingRefs,
        hint: 'pass force:true to attempt the query anyway',
      };
    }
  }

  const limit = Math.min(args.limit ?? 10, MAX_LIMIT);
  // Convert calendar-aligned "last N week/month/quarter/year" strings to
  // rolling [ISO, ISO] tuples before Cube parses them. Cube's own date-parser
  // would otherwise snap the window to completed calendar units and drop the
  // current period — surprising for chat-driven analytics.
  const normalizedTds = normalizeCubeDateRanges(args.query.timeDimensions);
  const query = { ...args.query, timeDimensions: normalizedTds, limit };

  // Cache lookup. Key includes cube_meta_hash so schema changes invalidate
  // entries naturally; TTL inside the adapter bounds staleness for in-place
  // data changes. Skip silently when there's no db handle on ctx (unit tests).
  const metaHash = await cubeMetaCache.getMetaVersion(ctx.gameId, ctx.workspace).catch(() => null);
  if (ctx.db) {
    const cached = getCachedLoad(ctx.db, {
      query,
      gameId: ctx.gameId,
      metaHash,
    });
    if (cached) {
      return {
        rows: cached.slice(0, MAX_LIMIT),
        rowCount: cached.length,
        warnings: [],
      };
    }
  }

  // Route through the workspace-aware Fastify proxy. The proxy resolves
  // auth + base URL from the X-Cube-Workspace header (server-authoritative),
  // so chat-service neither forwards nor needs to know the cube token here.
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

  const data = await res.json() as { data?: Record<string, string | number>[] };
  const rows = data?.data ?? [];

  // Skip caching empty results. Empty rows are almost always transient (Cube
  // mid-rebuild, Trino blip, late-arriving data). Caching them for 10 min
  // freezes a "no data" state in the agent — every retry within the TTL
  // window returns the same empty payload, and any chart emission fails
  // because ChartSpec requires data.min(1). Real query results always cache.
  if (ctx.db && rows.length > 0) {
    putCachedLoad(ctx.db, {
      query,
      gameId: ctx.gameId,
      metaHash,
      rows,
    });
  }

  return {
    rows: rows.slice(0, MAX_LIMIT),
    rowCount: rows.length,
    warnings: [],
  };
}
