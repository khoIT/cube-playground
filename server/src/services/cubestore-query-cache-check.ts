/**
 * "Does this query have cache?" — resolve a Cube query to the pre-aggregation(s)
 * it would route to (via the /sql dry-run), then check whether those tables are
 * actually MATERIALISED and serving in CubeStore. This is what makes the
 * passthrough trap legible: a query can plan to use a rollup that is defined but
 * has no active partitions → it silently falls through to source.
 */

import { sqlWithCtx, type WorkspaceCtx } from './cube-client.js';
import { resolveCubeTokenForWorkspace } from './resolve-cube-token.js';
import {
  findPreaggByTableName,
  isCubestoreIntrospectEnabled,
} from './cubestore-introspect.js';
import type { WorkspaceDef } from './workspaces-config-loader.js';

export type CacheVerdict = 'materialized' | 'registered-not-active' | 'not-built';

export interface QueryCachePreagg {
  preAggregationId: string;
  tableName: string;
  verdict: CacheVerdict;
  activePartitions: number;
  rows: number;
  bytes: number;
  buildRangeEnd: string | null;
}

export interface QueryCacheCheck {
  enabled: boolean;
  /** True only when a planned rollup is materialised AND serving (active). */
  willServeFromCache: boolean;
  preaggs: QueryCachePreagg[];
  note: string | null;
  error: string | null;
}

/** Pull the planned pre-aggregations out of a /sql dry-run body, tolerant of
 *  the single-object vs array `sql` shapes Cube returns. */
export function extractPlannedPreaggs(body: unknown): Array<{ preAggregationId: string; tableName: string }> {
  const sql = (body as { sql?: unknown } | null)?.sql;
  const node = (Array.isArray(sql) ? sql[0] : sql) as { preAggregations?: unknown } | undefined;
  const pa = node?.preAggregations;
  if (!Array.isArray(pa)) return [];
  return pa.map((x) => {
    const o = x as { preAggregationId?: unknown; tableName?: unknown };
    return { preAggregationId: String(o.preAggregationId ?? ''), tableName: String(o.tableName ?? '') };
  });
}

function buildCtx(workspace: WorkspaceDef, gameId: string): WorkspaceCtx {
  const { token } = resolveCubeTokenForWorkspace(workspace, gameId);
  return { cubeApiUrl: workspace.cubeApiUrl, token };
}

export async function checkQueryCache(
  workspace: WorkspaceDef,
  gameId: string,
  query: unknown,
): Promise<QueryCacheCheck> {
  if (!isCubestoreIntrospectEnabled()) {
    return { enabled: false, willServeFromCache: false, preaggs: [], note: null, error: null };
  }
  try {
    const body = await sqlWithCtx(query, buildCtx(workspace, gameId));
    const planned = extractPlannedPreaggs(body);
    if (planned.length === 0) {
      return {
        enabled: true,
        willServeFromCache: false,
        preaggs: [],
        note: 'Query routes to source — no rollup matches its members/grain.',
        error: null,
      };
    }

    const preaggs: QueryCachePreagg[] = [];
    for (const p of planned) {
      const m = await findPreaggByTableName(p.tableName);
      const verdict: CacheVerdict = !m
        ? 'not-built'
        : m.activePartitions > 0 && m.readyCount > 0
          ? 'materialized'
          : 'registered-not-active';
      preaggs.push({
        preAggregationId: p.preAggregationId,
        tableName: p.tableName,
        verdict,
        activePartitions: m?.activePartitions ?? 0,
        rows: m?.rows ?? 0,
        bytes: m?.bytes ?? 0,
        buildRangeEnd: m?.buildRangeEnd ?? null,
      });
    }
    return {
      enabled: true,
      willServeFromCache: preaggs.some((p) => p.verdict === 'materialized'),
      preaggs,
      note: null,
      error: null,
    };
  } catch (err) {
    return { enabled: true, willServeFromCache: false, preaggs: [], note: null, error: (err as Error).message };
  }
}
