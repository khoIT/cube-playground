/**
 * Cell formatter for 360 panels. Superset of the KPI-card `formatValue`:
 * adds ISO-date shortening, relative-date and tenure forms, and human-readable
 * durations. Currency/compact magnitudes delegate to the shared compact core
 * (one B/M/k formatter codebase-wide). Never throws — unknown shapes fall back
 * to their string form. `formatCellExact` supplies the full-precision tooltip
 * counterpart when the display form is lossy.
 */

import type { FormatId } from '../presets/types';
import { formatCompact, COMPACT_THRESHOLD } from '../detail/cards/format-value';

const MS_PER_DAY = 86_400_000;

function humanizeSeconds(n: number): string {
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.round(n / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** "2026-06-05" → "5 Jun 2026". Returns null when not an ISO date. */
function shortDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Whole days between an ISO date and `now`, against local midnights (warehouse
 * dates are date-only GMT+7 business dates). Negative = future.
 */
function daysAgo(iso: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - d.getTime()) / MS_PER_DAY);
}

/** Relative tier: Today / Nd ago / Nmo ago / Ny ago (~30d months, ~365d years). */
function relativeSuffix(days: number): string {
  if (days <= 0) return 'today';
  if (days < 60) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  const y = days / 365;
  return `${y >= 10 ? Math.round(y) : Math.round(y * 10) / 10}y ago`;
}

export function formatCell(value: unknown, format?: FormatId, now: Date = new Date()): string {
  if (value == null || value === '') return '—';

  const s = String(value);

  if (format === 'date-relative') {
    const short = shortDate(s);
    if (!short) return s;
    const days = daysAgo(s, now);
    if (days == null) return short;
    return days <= 0 ? 'Today' : `${short} (${relativeSuffix(days)})`;
  }

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
      if (!numeric) return s;
      // Million-and-above compacts (₫10.29B); exact value via formatCellExact.
      return Math.abs(n) >= COMPACT_THRESHOLD
        ? `₫${formatCompact(n)}`
        : n.toLocaleString(undefined, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
    case 'duration':
      return numeric ? humanizeSeconds(n) : s;
    case 'compact':
      return numeric ? formatCompact(n) : s;
    case 'tenure': {
      if (!numeric) return s;
      const d = Math.round(n);
      // Year approximation only earns its noise past ~1y.
      return d >= 365 ? `${d}d (~${Math.round((d / 365) * 10) / 10}y)` : `${d}d`;
    }
    case 'number':
      return numeric ? n.toLocaleString() : s;
    default:
      return s;
  }
}

/**
 * Full-precision counterpart for hover tooltips. Returns null when the display
 * form already carries full precision (callers skip the title attribute).
 */
export function formatCellExact(value: unknown, format?: FormatId): string | null {
  if (value == null || value === '') return null;

  if (format === 'date-relative' || format === 'tenure') {
    // Display is derived/rounded — the raw value is the exact form.
    return String(value);
  }

  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || String(value).trim() === '') return null;

  switch (format) {
    case 'currency':
      return Math.abs(n) >= COMPACT_THRESHOLD
        ? n.toLocaleString(undefined, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
        : null;
    case 'compact':
      return Math.abs(n) >= 1_000 ? n.toLocaleString() : null;
    case 'duration':
      return n >= 60 ? `${Math.round(n).toLocaleString()}s` : null;
    default:
      return null;
  }
}
