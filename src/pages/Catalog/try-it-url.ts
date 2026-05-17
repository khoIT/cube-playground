/**
 * try-it-url — small helper that builds `/build?...` deep-link URLs from a
 * Metric Card. The Builder's URL reader at QueryBuilder.tsx parses the same
 * params and applies them atomically via `setQuery(query)`.
 *
 * URL contract (additive, backwards compatible with the existing `?cube=`):
 *   cube     — Cube name (required)
 *   measure  — fully-qualified measure name (e.g. "active_daily.dau")
 *   time     — fully-qualified time dim + granularity, dot-joined
 *              (e.g. "active_daily.log_date.day"). Granularity defaults to
 *              "day" if absent; the parser splits on the final dot.
 *   range    — Cube native dateRange string ("last 30 days", "this month").
 *              URL-encoded only here; the reader URI-decodes verbatim and
 *              passes through to Query.timeDimensions[0].dateRange.
 */

export const DEFAULT_RANGE = 'last 30 days';
export const DEFAULT_GRANULARITY = 'day';

export interface BuildTryItUrlInput {
  cube: string;
  measure?: string;
  timeFqn?: string;
  granularity?: string;
  range?: string;
}

export function buildTryItUrl(input: BuildTryItUrlInput): string {
  const params = new URLSearchParams();
  params.set('cube', input.cube);
  if (input.measure) params.set('measure', input.measure);
  if (input.timeFqn) {
    const granularity = input.granularity ?? DEFAULT_GRANULARITY;
    params.set('time', `${input.timeFqn}.${granularity}`);
  }
  if (input.range) params.set('range', input.range);
  return `/build?${params.toString()}`;
}

/**
 * Builds the metric-card route URL from a fully-qualified measure name
 * (`<cube>.<member>`). Single-sourced so the two-segment route convention
 * lives in exactly one place.
 */
export function buildMetricUrl(measureName: string): string {
  const firstDot = measureName.indexOf('.');
  if (firstDot < 0) return `/metric/${encodeURIComponent(measureName)}`;
  const cubePart = measureName.slice(0, firstDot);
  const memberPart = measureName.slice(firstDot + 1);
  return `/metric/${encodeURIComponent(cubePart)}/${encodeURIComponent(memberPart)}`;
}
