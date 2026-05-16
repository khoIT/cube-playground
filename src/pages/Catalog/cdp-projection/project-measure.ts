/**
 * Pure projection of a Cube measure into the CDP `Metric` payload shape.
 * No fetch, no React, no IO. All branches covered by `__tests__/project-measure.test.ts`.
 *
 * Mapping table — architecture doc §3.3:
 *   count                       → COUNT(*)
 *   sum, sql: x                 → SUM(x)
 *   count_distinct, sql: x      → COUNT(DISTINCT x)
 *   count_distinct_approx, x    → approx_distinct(x)
 *   any agg + filters: [{sql}]  → filter = "(p1) AND (p2) …"
 *   number type w/ {ref}        → not-projectable: references-other-measures
 *   multi-cube view             → not-projectable: not-single-source
 */

import type {
  CdpMetricPayload,
  ProjectableCube,
  ProjectableDimension,
  ProjectableMeasure,
  ProjectionResult,
} from './types';

const MEASURE_REF_RE = /\{[A-Za-z_]\w*\}/;

export function projectMeasure(
  cube: ProjectableCube,
  measure: ProjectableMeasure,
): ProjectionResult {
  if (cube.type === 'view') {
    return { ok: false, reason: 'not-single-source' };
  }
  if (!cube.meta?.game_id || !cube.meta?.cdp_source) {
    return { ok: false, reason: 'missing-cube-meta' };
  }
  if (referencesOtherMeasures(measure)) {
    return { ok: false, reason: 'references-other-measures' };
  }

  const expression = buildExpression(measure);
  if (expression === null) {
    return { ok: false, reason: 'unsupported-agg-type' };
  }

  const filter = buildFilter(measure.filters);
  const metricName = stripCubePrefix(measure.name);

  const payload: CdpMetricPayload = {
    game_id: cube.meta.game_id,
    metric_name: metricName,
    metric_codename: metricName,
    source: cube.meta.cdp_source,
    expression,
    dimensions: projectDimensions(cube.dimensions),
    filter,
  };
  return { ok: true, payload };
}

function referencesOtherMeasures(measure: ProjectableMeasure): boolean {
  const isCalculated = (measure.aggType ?? measure.type) === 'number';
  if (!isCalculated) return false;
  return typeof measure.sql === 'string' && MEASURE_REF_RE.test(measure.sql);
}

function buildExpression(measure: ProjectableMeasure): string | null {
  const agg = measure.aggType;
  switch (agg) {
    case 'count':
      return 'COUNT(*)';
    case 'sum':
      return measure.sql ? `SUM(${measure.sql})` : null;
    case 'count_distinct':
      return measure.sql ? `COUNT(DISTINCT ${measure.sql})` : null;
    case 'count_distinct_approx':
      return measure.sql ? `approx_distinct(${measure.sql})` : null;
    default:
      return null;
  }
}

function buildFilter(filters: ProjectableMeasure['filters']): string {
  if (!filters || filters.length === 0) return '';
  return filters.map((f) => `(${f.sql})`).join(' AND ');
}

/**
 * CDP `dimensions` = the grain at which the metric is computed (the source
 * cube's primary-key columns). Synthetic composite PKs are marked
 * `public: false` in cube meta and are excluded — they are SQL expressions,
 * not real columns in the source table.
 */
function projectDimensions(dimensions: ProjectableDimension[]): string[] {
  const grain = dimensions.filter((d) => d.primaryKey === true && d.public !== false);
  const stripped = grain.map((d) => stripCubePrefix(d.name));
  const deduped = Array.from(new Set(stripped));
  deduped.sort();
  return deduped;
}

function stripCubePrefix(qualified: string): string {
  const dot = qualified.indexOf('.');
  return dot >= 0 ? qualified.slice(dot + 1) : qualified;
}
