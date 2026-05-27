/**
 * Humanises numeric values in assistant chart artifacts.
 *
 * The LLM emits raw numbers (e.g. 314_982_000 for VND revenue). Rendering
 * them as-is is unreadable and inflates Y-axis labels. This module derives
 * a per-chart or per-column unit from the spec's title + column name and
 * produces compact / readable strings:
 *
 *   - VND        → "315M VND" (axis: "315M")
 *   - USD        → "$1.5K"   (axis: "1.5K")
 *   - percent    → "12.3%"
 *   - count      → "16,424"
 *   - unknown    → "16,424"  (thousand-sep fallback)
 *
 * Captions are deliberately excluded — they're human-readable prose
 * ("spike of +47%…") that routinely contains symbols mistakable for unit
 * declarations. Detection is conservative: when uncertain it falls back to
 * thousand-sep, which is still better than a raw 9-digit number.
 */
import type { ChartSpec } from '../../../api/chat-sse-client';

export type ValueUnit = 'vnd' | 'usd' | 'percent' | 'count' | 'unknown';

interface DetectionContext {
  /** Declarative text from the chart (title only — captions are prose). */
  text: string;
  /** Column / field name (e.g. "revenue_vnd"). */
  column?: string;
}

const VND_RE = /\bvn[dđ]\b/i;
const USD_RE = /\busd\b|\$/i;
// Require `(%)` parens or the bare word `percent` — `+47%` in prose is a
// delta annotation, not a unit. The column-name suffix regex below is the
// stronger signal when the chart genuinely measures a percentage.
const PERCENT_RE = /\(\s*%\s*\)|\bpercent\b/i;
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
  return detectUnit({ text: spec.title ?? '', column: spec.encoding.value });
}

/** Detect unit for one column inside a chart's data rows. */
export function detectColumnUnit(column: string, spec?: ChartSpec): ValueUnit {
  return detectUnit({ text: spec?.title ?? '', column });
}

/**
 * Human-readable label for a single column, so the reader knows what an axis
 * means at a glance instead of inferring it from the title. Known units map to
 * a short symbol/word; otherwise fall back to the humanised column name (e.g.
 * "user_count" → "User count"), which is still the best available descriptor.
 */
export function columnAxisLabel(column: string, spec: ChartSpec): string {
  switch (detectColumnUnit(column, spec)) {
    case 'vnd':
      return 'VND';
    case 'usd':
      return 'USD ($)';
    case 'percent':
      return '%';
    case 'count':
      return 'Count';
    default:
      return humaniseColumn(column);
  }
}

/** Label for the value (Y) axis — the common case for category×value charts. */
export function axisUnitLabel(spec: ChartSpec): string {
  return columnAxisLabel(spec.encoding.value, spec);
}

function humaniseColumn(col: string): string {
  const words = col.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
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
 * How to scale a percent column for display: Cube `format: percent` measures
 * arrive as fractions (0.0069 = 0.69%), but some series are already in 0–100
 * units (42.5 = 42.5%). Decide once per chart from the data: if every value
 * sits within [-1, 1] it's a fraction → ×100; otherwise it's already a percent.
 * Returning the factor (not mutating values) keeps axis/tooltip/table in sync.
 */
export function detectPercentScale(values: Array<number | string>): 100 | 1 {
  let sawValue = false;
  for (const v of values) {
    const n = toNumber(v);
    if (n === null) continue;
    sawValue = true;
    if (Math.abs(n) > 1) return 1;
  }
  return sawValue ? 100 : 1;
}

/**
 * Percent with adaptive precision so small rates stay legible instead of
 * collapsing to "0%": more decimals the smaller the magnitude (0.69%, 4.4%,
 * 42%). `scale` comes from detectPercentScale.
 */
function formatPercent(n: number, scale: 100 | 1): string {
  const p = n * scale;
  const a = Math.abs(p);
  const decimals = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 1 : a > 0 ? 2 : 0;
  return `${p.toLocaleString('en-US', { maximumFractionDigits: decimals })}%`;
}

/**
 * Format a number for an axis tick (very compact — no unit suffix when long).
 * "VND" is dropped on the axis (the title already carries the unit) and the
 * compact suffix (K/M/B) does the heavy lifting. `percentScale` (from
 * detectPercentScale) converts fractional percents to display units.
 */
export function formatAxisValue(
  value: number | string,
  unit: ValueUnit,
  percentScale: 100 | 1 = 1,
): string {
  const n = toNumber(value);
  if (n === null) return String(value);
  if (unit === 'percent') return formatPercent(n, percentScale);
  if (unit === 'usd') return `$${COMPACT_AXIS_FMT.format(n)}`;
  return COMPACT_AXIS_FMT.format(n);
}

/**
 * Format a number for a tooltip / pie label / data-table cell. Includes the
 * unit so the reader doesn't have to glance back at the title.
 */
export function formatReadableValue(
  value: number | string,
  unit: ValueUnit,
  percentScale: 100 | 1 = 1,
): string {
  const n = toNumber(value);
  if (n === null) return String(value);
  if (unit === 'percent') return formatPercent(n, percentScale);
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
