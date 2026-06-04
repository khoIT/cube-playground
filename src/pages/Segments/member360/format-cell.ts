/**
 * Cell formatter for 360 panels. Superset of the KPI-card `formatValue`:
 * adds ISO-date shortening and human-readable durations, keeps `currency` as
 * VND (the native warehouse currency for *_vnd fields). Never throws — unknown
 * shapes fall back to their string form.
 */

import type { FormatId } from '../presets/types';

function humanizeSeconds(n: number): string {
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.round(n / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function formatCell(value: unknown, format?: FormatId): string {
  if (value == null || value === '') return '—';

  const s = String(value);
  // ISO date / timestamp → date (or date + time for event streams).
  const isoMatch = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(s);
  if (isoMatch && !format) {
    return isoMatch[2] ? `${isoMatch[1]} ${isoMatch[2]}` : isoMatch[1];
  }

  const n = typeof value === 'number' ? value : Number(value);
  const numeric = Number.isFinite(n) && s.trim() !== '';

  switch (format) {
    case 'percent':
      return numeric ? `${(n * 100).toFixed(1)}%` : s;
    case 'currency':
      return numeric
        ? n.toLocaleString(undefined, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
        : s;
    case 'duration':
      return numeric ? humanizeSeconds(n) : s;
    case 'compact':
      if (!numeric) return s;
      if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
      if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
      return String(Math.round(n));
    case 'number':
      return numeric ? n.toLocaleString() : s;
    default:
      return s;
  }
}
