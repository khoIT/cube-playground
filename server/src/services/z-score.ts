/**
 * Pure z-score helpers — kept side-effect-free so they can be tested without
 * spinning up Cube or fastify.
 *
 * Detection rules (v1):
 *   - Baseline = first N-1 values of the series; latest = last value.
 *   - Skip series when baseline length < 5 (insufficient signal) or when the
 *     baseline stddev rounds to 0 (constant series — z-score divides by 0).
 *   - |z| < 2          → 'none'
 *   - z >= +2          → 'high' (positive deviation)
 *   - z <= -2          → 'low'  (negative deviation)
 *   - |z| < 2 but last 5 points monotonic vs baseline direction → 'trend'
 *
 * deltaPct compares latest to baseline mean.
 */

import type { BusinessMetricAnomalyState } from '../types/business-metric.js';

export interface ZScoreResult {
  state: BusinessMetricAnomalyState;
  z: number;
  deltaPct: number;
}

const Z_THRESHOLD = 2;
const TREND_WINDOW = 5;
const MIN_BASELINE = 5;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) s += (x - mu) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

function detectTrend(latest: number, baseline: number[]): boolean {
  if (baseline.length < TREND_WINDOW) return false;
  const tail = baseline.slice(-TREND_WINDOW);
  const direction = Math.sign(latest - tail[0]);
  if (direction === 0) return false;
  for (let i = 1; i < tail.length; i++) {
    if (Math.sign(tail[i] - tail[i - 1]) !== direction) return false;
  }
  return true;
}

export function classifySeries(series: number[]): ZScoreResult | null {
  if (series.length < MIN_BASELINE + 1) return null;
  const baseline = series.slice(0, -1);
  const latest = series[series.length - 1];
  const mu = mean(baseline);
  const sigma = stddev(baseline, mu);
  if (sigma === 0 || !Number.isFinite(sigma)) return null;
  const z = (latest - mu) / sigma;
  const deltaPct = mu !== 0 ? ((latest - mu) / mu) * 100 : 0;

  let state: BusinessMetricAnomalyState;
  if (z >= Z_THRESHOLD) state = 'high';
  else if (z <= -Z_THRESHOLD) state = 'low';
  else if (detectTrend(latest, baseline)) state = 'trend';
  else state = 'none';

  return { state, z, deltaPct };
}
