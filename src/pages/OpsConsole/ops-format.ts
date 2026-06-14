/**
 * Display formatters for the Ops Console. Pure — unit-testable.
 * Money is Vietnamese đồng (₫) rendered in compact B/M/K scale.
 */

export function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** ₫43.96B / ₫2.88B / ₫512.0M / ₫1,731 */
export function formatVnd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `₫${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `₫${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `₫${Math.round(value).toLocaleString('en-US')}`;
  return `₫${Math.round(value)}`;
}

/** 166,732 */
export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** 50.4k / 1.2M for large counts */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return formatInt(value);
}

/** +12% / −4% / — */
export function formatDeltaPct(delta: number | null): string {
  if (delta == null) return '—';
  const pct = Math.round(delta * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

export function formatPct(rate: number | null, digits = 0): string {
  if (rate == null) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}
