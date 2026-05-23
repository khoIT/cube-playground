/**
 * explore-query-builder — derives a meaningful drill-down Cube.js Query from
 * a BusinessMetric. The Playground reads `?query=<JSON>` from the URL and
 * applies it as a new tab.
 *
 * Heuristics (no per-game schema introspection, keep it static + safe):
 *   1. Measures = numerator/denominator/inputs/ref from the formula.
 *   2. Time dimension = `<primaryCube>.event_date` at day granularity. The
 *      cube convention in this repo is `event_date` everywhere; we don't
 *      hit /meta to confirm because the Playground will surface a friendly
 *      error if the dim is absent, and the user can adjust.
 *   3. dateRange defaults to `last 30 days` — gives the analyst a useful
 *      window to *see* the metric's shape on landing.
 *   4. Order = timeDim desc, so the most recent point is up top.
 *
 * "Primary cube" = the cube that owns the first measure ref (numerator for
 * ratios). This keeps the timeDim aligned with the lead series.
 */

import type { BusinessMetric } from '../metrics-tab/business-metric-types';

export const EXPLORE_DEFAULT_GRANULARITY = 'day';
export const EXPLORE_DEFAULT_RANGE = 'last 30 days';
export const EXPLORE_TIME_DIM = 'event_date';

export interface ExploreQuery {
  measures: string[];
  dimensions: string[];
  timeDimensions: Array<{
    dimension: string;
    granularity: string;
    dateRange: string;
  }>;
  filters: unknown[];
  order: Record<string, 'asc' | 'desc'>;
  limit: number;
}

function measuresFromFormula(metric: BusinessMetric): string[] {
  const f = metric.formula;
  if (f.type === 'measure') return [f.ref];
  if (f.type === 'ratio') return [f.numerator, f.denominator];
  if (f.type === 'expression') return f.inputs ?? [];
  return [];
}

function primaryCube(measures: string[]): string | null {
  const first = measures[0];
  if (!first) return null;
  const dot = first.indexOf('.');
  return dot > 0 ? first.slice(0, dot) : null;
}

/**
 * Returns the time dimension FQN to anchor the drill-down. Currently a pure
 * convention; once Cube `/meta` is wired we can verify the dim exists per
 * game and fall back to "no timeDim" gracefully.
 */
export function timeDimensionFor(metric: BusinessMetric): string | null {
  const cube = primaryCube(measuresFromFormula(metric));
  return cube ? `${cube}.${EXPLORE_TIME_DIM}` : null;
}

export function buildExploreQuery(metric: BusinessMetric): ExploreQuery {
  const measures = measuresFromFormula(metric);
  const timeDim = timeDimensionFor(metric);
  const timeDimensions = timeDim
    ? [
        {
          dimension: timeDim,
          granularity: EXPLORE_DEFAULT_GRANULARITY,
          dateRange: EXPLORE_DEFAULT_RANGE,
        },
      ]
    : [];
  return {
    measures,
    dimensions: [],
    timeDimensions,
    filters: [],
    order: timeDim ? { [timeDim]: 'desc' } : {},
    limit: 1000,
  };
}

/**
 * Stable, replay-able URL. `from=catalog` is a marker the Playground reads
 * to know it should consume the `query` param even if it has been seen
 * before (KeepAlive cache busting at the data layer, not the routing layer).
 */
export function buildExploreUrl(metric: BusinessMetric): string {
  const query = buildExploreQuery(metric);
  const search = new URLSearchParams();
  search.set('query', JSON.stringify(query));
  search.set('from', `catalog:${metric.id}`);
  return `/build?${search.toString()}`;
}
