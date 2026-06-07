/** Shared formatters used by KPI + chart cards. */

import type { FormatId } from '../../presets/types';

/** Trim trailing zeros from a fixed-decimal string: "10.00" → "10", "7.60" → "7.6". */
function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Compact magnitude form with a billion tier:
 * 932 → "932", 7,612 → "7.6k", 1,355,623 → "1.36M", 10,286,465,000 → "10.29B".
 */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trimZeros((n / 1e9).toFixed(2))}B`;
  if (abs >= 1e6) return `${trimZeros((n / 1e6).toFixed(2))}M`;
  if (abs >= 1e3) return `${trimZeros((n / 1e3).toFixed(1))}k`;
  return String(Math.round(n));
}

/** Values at/above this magnitude compact even in 'currency'/'number' formats. */
const COMPACT_THRESHOLD = 1_000_000;

export function formatValue(value: unknown, format: FormatId | undefined): string {
  if (value == null) return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);

  switch (format) {
    case 'percent':
      return `${(n * 100).toFixed(1)}%`;
    case 'currency':
      // Million-and-above currency compacts (₫10.29B); the exact value
      // belongs in a hover tooltip via formatValueExact.
      return Math.abs(n) >= COMPACT_THRESHOLD
        ? `₫${formatCompact(n)}`
        : n.toLocaleString(undefined, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
    case 'duration':
      return `${n.toFixed(0)}s`;
    case 'compact':
      return formatCompact(n);
    case 'number':
    default:
      return Math.abs(n) >= COMPACT_THRESHOLD ? formatCompact(n) : n.toLocaleString();
  }
}

/**
 * Full-precision counterpart for hover tooltips. Returns null when the
 * display form already carries full precision (so callers can skip the
 * title attribute instead of repeating the visible text).
 */
export function formatValueExact(value: unknown, format: FormatId | undefined): string | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;

  switch (format) {
    case 'currency':
      return Math.abs(n) >= COMPACT_THRESHOLD
        ? n.toLocaleString(undefined, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
        : null;
    case 'compact':
      return Math.abs(n) >= 1_000 ? n.toLocaleString() : null;
    case 'number':
      return Math.abs(n) >= COMPACT_THRESHOLD ? n.toLocaleString() : null;
    default:
      return null;
  }
}
