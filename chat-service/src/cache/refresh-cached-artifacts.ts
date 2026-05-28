/**
 * Refresh hook for replayCachedTurn.
 *
 * On cache-hit, for any chart that points back to a query_artifact via
 * artifactRef, re-execute the artifact's Cube query and rewrite the chart's
 * inline data rows from the live result. Charts without an artifactRef are
 * left untouched (we have no query to re-run for them).
 *
 * Failure is best-effort: a missing/malformed artifact or a Cube error leaves
 * the chart's cached data in place. Overall outcome is 'refreshed' iff at
 * least one chart was successfully re-executed; otherwise 'stale'.
 *
 * Query artifacts themselves don't carry rows (the FE re-fetches at render),
 * so they pass through unchanged — the refresh applies only to chart data.
 */

import type Database from 'better-sqlite3';
import type { QueryArtifact, ChartArtifact, CubeQuery } from '../types.js';
import type { ChartSpec } from '../services/chart-spec.js';
import { truncateTopN } from '../services/chart-spec.js';
import { config } from '../config.js';
import { getCachedLoad, putCachedLoad } from './load-cache-adapter.js';
import type { ReplayOutcome } from './replay-cached-turn.js';

/**
 * Re-run a Cube /load through the workspace-aware Fastify proxy. Returns rows
 * or throws. The proxy resolves auth + base URL from the X-Cube-Workspace
 * header; chat-service no longer ferries a cube token here.
 */
async function runCubeLoad(
  query: CubeQuery,
  workspace: string,
  gameId: string,
): Promise<Record<string, string | number>[]> {
  const url = `${config.serverBaseUrl}/cube-api/v1/load`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Cube-Workspace': workspace,
      'X-Cube-Game': gameId,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cube /load failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Record<string, string | number>[] };
  return json?.data ?? [];
}

/**
 * Wrap runCubeLoad with the kv_cache load adapter. Hit returns cached rows;
 * miss runs the live /load and writes back. Used by the chart-refresh path so
 * the cache-hit replay benefits from the same row cache as preview_cube_query.
 */
async function runCubeLoadCached(
  db: Database.Database | null,
  gameId: string,
  workspace: string,
  metaHash: string | null,
  query: CubeQuery,
): Promise<Record<string, string | number>[]> {
  if (db) {
    const hit = getCachedLoad(db, { query, gameId, metaHash });
    if (hit) return hit;
  }
  const rows = await runCubeLoad(query, workspace, gameId);
  // Mirrors preview-cube-query: skip caching empty results to avoid freezing
  // a transient "no data" state for the load-cache TTL window.
  if (db && rows.length > 0) putCachedLoad(db, { query, gameId, metaHash, rows });
  return rows;
}

/**
 * Rewrite a chart's `spec.data` from fresh rows + reapply truncateTopN to keep
 * top-N + "Other" semantics identical to first-emit. Returns the new chart
 * (preserving id + artifactRef) or null if reshape yielded an empty set.
 */
function rebuildChartWithRows(
  chart: ChartArtifact,
  freshRows: Record<string, string | number>[],
): ChartArtifact | null {
  if (freshRows.length === 0) return null;
  // Keep the chart type/encoding/title; only swap data.
  const nextSpec = { ...chart.spec, data: freshRows } as ChartSpec;
  const { spec, truncated, originalRowCount } = truncateTopN(nextSpec);
  return {
    ...chart,
    spec,
    truncated,
    originalRowCount,
  };
}

export interface RefreshDeps {
  /** Workspace id ("local", "prod", …) — routed through the Fastify proxy. */
  workspace: string;
  /**
   * DB handle to enable the kv_cache load adapter. Omit (or pass null) to
   * bypass the cache and always hit Cube live.
   */
  db?: Database.Database | null;
  gameId?: string;
  metaHash?: string | null;
  /** Override for tests. */
  cubeLoad?: (query: CubeQuery) => Promise<Record<string, string | number>[]>;
}

/**
 * Build a refresh hook bound to the current request's workspace + game.
 *
 * Usage:
 *   const refresh = buildRefreshHook({ workspace, db, gameId, metaHash });
 *   const outcome = await replayCachedTurn(cached, stream, emit, refresh);
 */
export function buildRefreshHook(deps: RefreshDeps) {
  const load =
    deps.cubeLoad ??
    ((q: CubeQuery) =>
      runCubeLoadCached(
        deps.db ?? null,
        deps.gameId ?? '',
        deps.workspace,
        deps.metaHash ?? null,
        q,
      ));

  return async function refresh(
    artifacts: QueryArtifact[],
    charts: ChartArtifact[],
  ): Promise<ReplayOutcome> {
    if (charts.length === 0) {
      // Nothing to refresh; artifacts ship as-is, FE re-fetches their data.
      return { artifacts, charts, freshness: 'stale' };
    }

    // Index artifacts by id so charts with artifactRef can locate their source query.
    const artifactById = new Map<string, QueryArtifact>();
    for (const a of artifacts) artifactById.set(a.id, a);

    let anyRefreshed = false;
    const nextCharts: ChartArtifact[] = [];

    for (const chart of charts) {
      if (!chart.artifactRef) {
        nextCharts.push(chart);
        continue;
      }
      const src = artifactById.get(chart.artifactRef);
      if (!src) {
        nextCharts.push(chart);
        continue;
      }
      try {
        const rows = await load(src.query);
        const rebuilt = rebuildChartWithRows(chart, rows);
        if (rebuilt) {
          nextCharts.push(rebuilt);
          anyRefreshed = true;
        } else {
          // Empty result set — keep cached chart, mark overall stale.
          nextCharts.push(chart);
        }
      } catch {
        // Per-chart failure is non-fatal; keep cached chart.
        nextCharts.push(chart);
      }
    }

    return {
      artifacts,
      charts: nextCharts,
      freshness: anyRefreshed ? 'refreshed' : 'stale',
    };
  };
}
