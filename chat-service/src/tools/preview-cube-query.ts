/**
 * Tool: preview_cube_query
 * Runs a Cube /load query and returns up to N rows (hard cap: 50).
 * Lets the agent sanity-check the query shape before emitting an artifact.
 */

import { z } from 'zod';
import { config } from '../config.js';
import type { ToolContext } from '../types.js';

export const name = 'preview_cube_query';
export const description =
  'Run a Cube query and return sample rows (max 50). ' +
  'Use this to validate the query shape before calling emit_query_artifact.';

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
};

const MAX_LIMIT = 50;

export async function handler(
  args: { query: z.infer<typeof CubeQuerySchema>; limit?: number },
  ctx: ToolContext,
): Promise<{ rows: unknown[]; rowCount: number; warnings: string[] }> {
  const limit = Math.min(args.limit ?? 10, MAX_LIMIT);
  const query = { ...args.query, limit };

  const url = `${config.serverBaseUrl}/cubejs-api/v1/load`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: ctx.cubeToken,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cube /load failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { data?: unknown[] };
  const rows = data?.data ?? [];

  return {
    rows: rows.slice(0, MAX_LIMIT),
    rowCount: rows.length,
    warnings: [],
  };
}
