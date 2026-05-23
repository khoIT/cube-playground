/**
 * explore-query-builder — derives a Cube.js drill-down query from a
 * BusinessMetric or a Concept fqn. The Playground reads `?query=<JSON>`
 * from the URL and applies it as a new tab.
 *
 * Heuristics:
 *   1. Measures = numerator/denominator/inputs/ref from the formula.
 *   2. Time dimension = picked from /meta via `pickExploreTimeDim` —
 *      prefers event-like dims (log_date, event_date, recharge_date…)
 *      and falls back to the cube's first time-typed dim. Omitted when
 *      meta isn't available or the cube has none — still a valid Cube
 *      query, just without a timeline.
 *   3. dateRange defaults to `last 30 days` to give the analyst a useful
 *      window on landing.
 *   4. Order = timeDim desc so the most recent point sits on top.
 *
 * "Primary cube" = the cube owning the first measure (numerator for
 * ratios). Time dim follows the lead series.
 */

import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import type { CatalogCube } from '../use-catalog-meta';
import { pickExploreTimeDim } from './pick-explore-time-dim';

export const EXPLORE_DEFAULT_GRANULARITY = 'day';
export const EXPLORE_DEFAULT_RANGE = 'last 30 days';

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

function cubeOf(member: string): string | null {
  const dot = member.indexOf('.');
  return dot > 0 ? member.slice(0, dot) : null;
}

function primaryCube(measures: string[]): string | null {
  const first = measures[0];
  return first ? cubeOf(first) : null;
}

export function timeDimensionFor(
  metric: BusinessMetric,
  cubes?: CatalogCube[] | null,
): string | null {
  const cube = primaryCube(measuresFromFormula(metric));
  return cube ? pickExploreTimeDim(cubes, cube) : null;
}

function buildQueryAround(measures: string[], timeDim: string | null): ExploreQuery {
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

export function buildExploreQuery(
  metric: BusinessMetric,
  cubes?: CatalogCube[] | null,
): ExploreQuery {
  const measures = measuresFromFormula(metric);
  return buildQueryAround(measures, timeDimensionFor(metric, cubes));
}

/**
 * Stable URL for "Open in Explore". `from=catalog:<id>` is a soft marker
 * for downstream consumers — the Playground itself dedupes by query hash,
 * not by this flag.
 */
export function buildExploreUrl(
  metric: BusinessMetric,
  cubes?: CatalogCube[] | null,
): string {
  const query = buildExploreQuery(metric, cubes);
  const search = new URLSearchParams();
  search.set('query', JSON.stringify(query));
  search.set('from', `catalog:${metric.id}`);
  return `/build?${search.toString()}`;
}

/**
 * Concept-detail counterpart — same heuristics but built from a measure FQN
 * (data-model tab, where the fqn already comes from /meta and is known to
 * exist on the cube).
 */
export function buildConceptExploreUrl(
  fqn: string,
  cubes?: CatalogCube[] | null,
): string {
  const cube = cubeOf(fqn);
  const timeDim = cube ? pickExploreTimeDim(cubes, cube) : null;
  const query = buildQueryAround([fqn], timeDim);
  const search = new URLSearchParams();
  search.set('query', JSON.stringify(query));
  search.set('from', `catalog:${encodeURIComponent(fqn)}`);
  return `/build?${search.toString()}`;
}
