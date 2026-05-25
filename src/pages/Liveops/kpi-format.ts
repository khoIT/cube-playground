/**
 * Formatting utilities for KPI tile values and deltas.
 */

import type { KpiSpec } from './kpi-config';
import type { KpiTileData } from './use-live-kpis-types';

const vndFmt = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export function formatValue(value: number, format?: KpiSpec['format']): string {
  if (!isFinite(value)) return '—';
  if (format === 'currency') return vndFmt.format(value);
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
  // compact number
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('vi-VN');
}

export function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)}%`;
}

export function deltaTone(delta: number, invertDelta?: boolean): KpiTileData['tone'] {
  if (delta === 0) return 'neutral';
  const positive = delta > 0;
  return positive !== (invertDelta === true) ? 'positive' : 'negative';
}

/**
 * For deltaWindow '1d': latest vs second-to-last day.
 * For deltaWindow '7d': avg of latest 7 vs avg of prior 7.
 */
export function computeDelta(values: number[], window: '1d' | '7d'): number | null {
  if (window === '1d') {
    if (values.length < 2) return null;
    const latest = values[values.length - 1];
    const prior = values[values.length - 2];
    if (prior === 0) return null;
    return (latest - prior) / prior;
  }
  // 7d: need at least 14 points
  if (values.length < 14) return null;
  const recent = values.slice(-7);
  const prior = values.slice(-14, -7);
  const avgRecent = recent.reduce((s, v) => s + v, 0) / recent.length;
  const avgPrior = prior.reduce((s, v) => s + v, 0) / prior.length;
  if (avgPrior === 0) return null;
  return (avgRecent - avgPrior) / avgPrior;
}
