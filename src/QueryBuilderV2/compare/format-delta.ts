/**
 * Delta-cell formatting for compare mode in the results table: signed compact
 * absolute delta, signed percent (input is a fraction, 0.05 = 5%), and a tone
 * classifier the table maps to success/danger colors.
 */

export type DeltaTone = 'positive' | 'negative' | 'flat';

/** Tone from a fractional Δ%: null/0 → flat. */
export function getDeltaTone(deltaPct: number | null): DeltaTone {
  if (deltaPct == null || deltaPct === 0) return 'flat';
  return deltaPct > 0 ? 'positive' : 'negative';
}

/** Signed compact absolute delta: 1234 → "+1.2K", -340 → "−340", null → "—". */
export function formatDeltaAbs(delta: number | null): string {
  if (delta == null) return '—';
  if (delta === 0) return '0';
  const sign = delta > 0 ? '+' : '−';
  const abs = Math.abs(delta);
  let body: string;
  if (abs >= 1e9) body = `${(abs / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) body = `${(abs / 1e6).toFixed(1)}M`;
  else if (abs >= 1e3) body = `${(abs / 1e3).toFixed(1)}K`;
  else body = new Intl.NumberFormat('en-US').format(abs);
  return `${sign}${body}`;
}

/** Signed percent from a fraction: 0.05 → "+5.0%", -0.123 → "−12.3%", null → "—". */
export function formatDeltaPct(deltaPct: number | null): string {
  if (deltaPct == null) return '—';
  if (deltaPct === 0) return '0%';
  const sign = deltaPct > 0 ? '+' : '−';
  return `${sign}${Math.abs(deltaPct * 100).toFixed(1)}%`;
}
