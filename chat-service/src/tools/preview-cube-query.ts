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
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { loadCubeRows } from '../services/load-cube-rows.js';
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

  // Delegate the normalize + cache + /load fetch to the shared executor
  // (also used by the emit_query_artifact chart fallback). Cap at MAX_LIMIT.
  const limit = Math.min(args.limit ?? 10, MAX_LIMIT);
  const rows = await loadCubeRows(args.query, ctx, { maxRows: limit });

  return {
    rows,
    rowCount: rows.length,
    warnings: [],
  };
}
