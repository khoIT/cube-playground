/**
 * Humanises numeric values in assistant chart artifacts.
 *
 * The LLM emits raw numbers (e.g. 314_982_000 for VND revenue). Rendering
 * them as-is is unreadable and inflates Y-axis labels. This module derives
 * a per-chart or per-column unit from the spec's textual cues (title,
 * caption, column name) and produces compact / readable strings:
 *
 *   - VND        → "315M VND" (axis: "315M")
 *   - USD        → "$1.5K"   (axis: "1.5K")
 *   - percent    → "12.3%"
 *   - count      → "16,424"
 *   - unknown    → "16,424"  (thousand-sep fallback)
 *
 * Detection is conservative: when uncertain it falls back to thousand-sep,
 * which is still better than a raw 9-digit number.
 */
import type { ChartSpec } from '../../../api/chat-sse-client';

export type ValueUnit = 'vnd' | 'usd' | 'percent' | 'count' | 'unknown';

interface DetectionContext {
  /** Free-form text from the chart (title + caption + axis labels). */
  text: string;
  /** Column / field name (e.g. "revenue_vnd"). */
  column?: string;
}

const VND_RE = /\bvn[dđ]\b/i;
const USD_RE = /\busd\b|\$/i;
const PERCENT_RE = /%|\bpercent\b/i;
const PERCENT_COLUMN_RE = /_pct$|_rate$|_share$|_percent$/i;
const VND_COLUMN_RE = /vnd|_vnd$/i;
const USD_COLUMN_RE = /usd|_usd$/i;

/** Detect a unit from chart title/caption + an optional column name. */
export function detectUnit(ctx: DetectionContext): ValueUnit {
  const { text, column } = ctx;
  if (column && VND_COLUMN_RE.test(column)) return 'vnd';
  if (column && USD_COLUMN_RE.test(column)) return 'usd';
  if (column && PERCENT_COLUMN_RE.test(column)) return 'percent';
  if (VND_RE.test(text)) return 'vnd';
  if (USD_RE.test(text)) return 'usd';
  if (PERCENT_RE.test(text)) return 'percent';
  return 'unknown';
}

/** Convenience: detect unit for a whole ChartSpec (uses encoding.value). */
export function detectChartUnit(spec: ChartSpec): ValueUnit {
  const text = `${spec.title ?? ''} ${spec.caption ?? ''}`;
  return detectUnit({ text, column: spec.encoding.value });
}

/** Detect unit for one column inside a chart's data rows. */
export function detectColumnUnit(column: string, spec?: ChartSpec): ValueUnit {
  const text = spec ? `${spec.title ?? ''} ${spec.caption ?? ''}` : '';
  return detectUnit({ text, column });
}

const COMPACT_AXIS_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const COMPACT_READABLE_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

const THOUSANDS_FMT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

/**
 * Format a number for an axis tick (very compact — no unit suffix when long).
 * "VND" is dropped on the axis (the title already carries the unit) and the
 * compact suffix (K/M/B) does the heavy lifting.
 */
export function formatAxisValue(value: number | string, unit: ValueUnit): string {
  const n = toNumber(value);
  if (n === null) return String(value);
  if (unit === 'percent') return `${COMPACT_AXIS_FMT.format(n)}%`;
  if (unit === 'usd') return `$${COMPACT_AXIS_FMT.format(n)}`;
  return COMPACT_AXIS_FMT.format(n);
}

/**
 * Format a number for a tooltip / pie label / data-table cell. Includes the
 * unit so the reader doesn't have to glance back at the title.
 */
export function formatReadableValue(value: number | string, unit: ValueUnit): string {
  const n = toNumber(value);
  if (n === null) return String(value);
  if (unit === 'percent') return `${THOUSANDS_FMT.format(n)}%`;
  if (unit === 'usd') return `$${formatNumeric(n)}`;
  if (unit === 'vnd') return `${formatNumeric(n)} VND`;
  if (unit === 'count') return THOUSANDS_FMT.format(n);
  // Unknown unit: thousand-sep so 16424 reads as 16,424.
  return THOUSANDS_FMT.format(n);
}

/** Compact notation for big numbers (≥10k), thousand-sep otherwise. */
function formatNumeric(n: number): string {
  return Math.abs(n) >= 10_000
    ? COMPACT_READABLE_FMT.format(n)
    : THOUSANDS_FMT.format(n);
}

function toNumber(v: number | string): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
