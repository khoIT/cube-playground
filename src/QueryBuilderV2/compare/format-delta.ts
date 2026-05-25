/**
 * Formatting utilities for compare-mode delta values.
 *
 * Mirrors the pattern from kpi-format.ts (Phase 1) but scoped to the
 * playground compare columns. Neutral color by default — no per-measure
 * invertDelta config is wired yet (YAGNI until measure config exists).
 *
 * - formatDeltaAbs  → formatted absolute delta string (e.g. "+1,234")
 * - formatDeltaPct  → formatted percentage delta string (e.g. "+12.3%")
 * - deltaPctDisplay → combined "—" fallback when delta is null
 */

import { formatNumber } from '../utils/formatters';

// ---------------------------------------------------------------------------
// Absolute delta
// ---------------------------------------------------------------------------

/**
 * Format the absolute delta value with sign prefix.
 * Returns "—" when delta is null.
 */
export function formatDeltaAbs(delta: number | null | undefined): string {
  if (delta == null || !isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${formatNumber(delta, 2, 0)}`;
}

// ---------------------------------------------------------------------------
// Percentage delta
// ---------------------------------------------------------------------------

/**
 * Format Δ% as a percentage string with sign prefix.
 * Input is a decimal fraction (0.05 = 5%).
 * Returns "—" when deltaPct is null (zero denominator or missing row).
 */
export function formatDeltaPct(deltaPct: number | null | undefined): string {
  if (deltaPct == null || !isFinite(deltaPct)) return '—';
  const pct = deltaPct * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Color tone (neutral by default, no invertDelta wiring yet)
// ---------------------------------------------------------------------------

export type DeltaTone = 'positive' | 'negative' | 'neutral';

/**
 * Derive the display tone for a Δ% value.
 * Always returns 'neutral' when deltaPct is null (missing data).
 * invertDelta is reserved for future measure-config wiring — pass false/undefined for now.
 */
export function getDeltaTone(
  deltaPct: number | null | undefined,
  _invertDelta?: boolean,
): DeltaTone {
  if (deltaPct == null || deltaPct === 0) return 'neutral';
  // invertDelta support intentionally deferred (YAGNI — no measure config yet).
  return deltaPct > 0 ? 'positive' : 'negative';
}
