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

import type { QueryArtifact, ChartArtifact, CubeQuery } from '../types.js';
import type { ChartSpec } from '../services/chart-spec.js';
import { truncateTopN } from '../services/chart-spec.js';
import { config } from '../config.js';
import type { ReplayOutcome } from './replay-cached-turn.js';

/** Re-run a Cube /load against the live API. Returns rows or throws. */
async function runCubeLoad(query: CubeQuery, cubeToken: string): Promise<Record<string, string | number>[]> {
  const url = `${config.cubeApiUrl}/cubejs-api/v1/load`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: cubeToken },
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
  cubeToken: string;
  /** Override for tests. */
  cubeLoad?: (query: CubeQuery) => Promise<Record<string, string | number>[]>;
}

/**
 * Build a refresh hook bound to the current request's Cube token.
 *
 * Usage:
 *   const refresh = buildRefreshHook({ cubeToken });
 *   const outcome = await replayCachedTurn(cached, stream, emit, refresh);
 */
export function buildRefreshHook(deps: RefreshDeps) {
  const load = deps.cubeLoad ?? ((q: CubeQuery) => runCubeLoad(q, deps.cubeToken));

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
