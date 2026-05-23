/**
 * Maps a business-metric formula → Cube query payloads that yield a daily
 * timeseries the anomaly detector can z-score against.
 *
 * `measure` formulas (`recharge.paying_users`) → single measures query with
 *   a daily granularity on the cube's first available timeDimension.
 *
 * `ratio` formulas → two queries; the detector computes `num/den` per day
 *   in memory. This trades two requests per metric for not having to invent
 *   ratio support inside Cube.
 *
 * `expression` formulas are out of scope for v1 (we can't safely parse a
 *   user-authored SQL/JS expression server-side).
 */

import type { BusinessMetric } from '../types/business-metric.js';

export interface CubeMeasure {
  name: string;
}

export interface CubeDimension {
  name: string;
  type?: string;
}

export interface CubeMetaCube {
  name: string;
  measures?: CubeMeasure[];
  dimensions?: CubeDimension[];
}

export interface CubeMeta {
  cubes: CubeMetaCube[];
}

const BASELINE_DAYS = 14;

function findTimeDimension(meta: CubeMeta, cubeName: string): string | null {
  const cube = meta.cubes.find((c) => c.name === cubeName);
  if (!cube) return null;
  const td = (cube.dimensions ?? []).find((d) => d.type === 'time');
  return td?.name ?? null;
}

function dateRange(): [string, string] {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - BASELINE_DAYS);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return [fmt(start), fmt(end)];
}

export interface PlannedQuery {
  measures: string[];
  timeDimensions: Array<{
    dimension: string;
    granularity: 'day';
    dateRange: [string, string];
  }>;
}

export interface PlanResult {
  /** Query for the numerator (or the only measure). */
  numerator: PlannedQuery;
  /** Present only when the metric is a ratio. */
  denominator?: PlannedQuery;
  /** The timeDimension we'll use to align both series. Caller reads it to
   *  index into Cube's result rows. */
  timeDimensionField: string;
}

function planSingleMeasure(
  meta: CubeMeta,
  measureRef: string,
): PlannedQuery | { error: string } {
  const cube = measureRef.split('.')[0];
  const td = findTimeDimension(meta, cube);
  if (!td) return { error: `no time dimension on cube ${cube}` };
  return {
    measures: [measureRef],
    timeDimensions: [
      { dimension: td, granularity: 'day', dateRange: dateRange() },
    ],
  };
}

/**
 * Plan the timeseries query/queries needed for one metric. Returns null when
 * the metric can't be planned (expression-type, missing cube, no time dim).
 */
export function planMetricQueries(
  metric: BusinessMetric,
  meta: CubeMeta,
): PlanResult | { skip: string } {
  const f = metric.formula;
  if (f.type === 'expression') {
    return { skip: 'expression formulas not supported in detector v1' };
  }

  if (f.type === 'measure') {
    const plan = planSingleMeasure(meta, f.ref);
    if ('error' in plan) return { skip: plan.error };
    return {
      numerator: plan,
      timeDimensionField: plan.timeDimensions[0].dimension,
    };
  }

  const num = planSingleMeasure(meta, f.numerator);
  if ('error' in num) return { skip: `numerator: ${num.error}` };
  const den = planSingleMeasure(meta, f.denominator);
  if ('error' in den) return { skip: `denominator: ${den.error}` };
  // Align both series on the numerator's time dimension when the cubes
  // diverge — Cube returns the timeDim under its full name in each query so
  // the caller resolves per-query.
  return {
    numerator: num,
    denominator: den,
    timeDimensionField: num.timeDimensions[0].dimension,
  };
}
