/**
 * Tool: explain_cube_sql
 * Compiles a Cube query to SQL via Cube's /sql endpoint and returns
 * the pretty-printed result so the user can inspect what will run.
 * Members are validated against /meta before the Cube call.
 */

import { z } from 'zod';
import { format } from 'sql-formatter';
import { config } from '../config.js';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
// Route Cube traffic through the workspace-aware Fastify proxy. Auth + base
// URL are server-authoritative there; no need to forward ctx.cubeToken.
import { CubeQuerySchema } from './preview-cube-query.js';
import type { ToolContext } from '../types.js';

export const name = 'explain_cube_sql';
export const description =
  'Compile a Cube query to SQL and return the pretty-printed SQL string. ' +
  'Useful for explaining what data will be fetched before emitting an artifact.';

export const inputSchema = {
  query: CubeQuerySchema,
  force: z
    .boolean()
    .optional()
    .describe('Set true to bypass the pre-flight ref guard and attempt SQL compilation anyway.'),
};

// Shape Cube returns for /sql
interface CubeSqlResponse {
  sql?: {
    sql?: [string, ...unknown[]] | string;
  };
}

type OkResult = { ok: true; sql: string };
type MetricDraftResult = {
  ok: false;
  error: 'metric_draft';
  missingRefs: string[];
  hint: string;
};
type CubeErrorResult = { ok: false; error: 'cube_error'; detail: { status: number; body: unknown } };

function extractRawSql(response: CubeSqlResponse): string | null {
  const sqlField = response?.sql?.sql;
  if (Array.isArray(sqlField)) return String(sqlField[0]);
  if (typeof sqlField === 'string') return sqlField;
  return null;
}

export async function handler(
  args: { query: z.infer<typeof CubeQuerySchema>; force?: boolean },
  ctx: ToolContext,
): Promise<OkResult | MetricDraftResult | CubeErrorResult> {
  if (!args.force) {
    const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
    const known = cubeMetaCache.extractMemberNames(meta);
    const missingRefs: string[] = [];
    for (const measure of args.query.measures ?? []) {
      if (!known.has(measure)) missingRefs.push(measure);
    }
    for (const dim of args.query.dimensions ?? []) {
      if (!known.has(dim)) missingRefs.push(dim);
    }
    for (const td of args.query.timeDimensions ?? []) {
      if (!known.has(td.dimension)) missingRefs.push(td.dimension);
    }
    if (missingRefs.length > 0) {
      return {
        ok: false,
        error: 'metric_draft',
        missingRefs,
        hint: 'pass force:true to attempt SQL compilation anyway',
      };
    }
  }

  // Route through the workspace-aware Fastify proxy so /sql lands on whatever
  // Cube backend the active workspace points at (local minted or prod open).
  const url = `${config.serverBaseUrl}/cube-api/v1/sql`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Cube-Workspace': ctx.workspace,
        'X-Cube-Game': ctx.gameId,
      },
      body: JSON.stringify({ query: args.query }),
    });
  } catch (err) {
    return { ok: false, error: 'cube_error', detail: { status: 0, body: String(err) } };
  }

  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text().catch(() => ''); }
    return { ok: false, error: 'cube_error', detail: { status: res.status, body } };
  }

  const data = await res.json() as CubeSqlResponse;
  const rawSql = extractRawSql(data);

  if (!rawSql) {
    return { ok: false, error: 'cube_error', detail: { status: 200, body: 'no sql in response' } };
  }

  const prettySql = format(rawSql, { language: 'postgresql' });
  return { ok: true, sql: prettySql };
}
