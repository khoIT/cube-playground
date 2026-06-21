/**
 * Small presentation helpers shared across Model Audit tabs: severity → token
 * mapping for cell/badge coloring and a compact relative-time formatter.
 */

import { SEVERITY_RANK } from './model-audit-types';

export interface SeverityTokens {
  soft: string;
  ink: string;
  label: string;
}

export const SEVERITY_TOKENS: Record<string, SeverityTokens> = {
  correctness: { soft: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Correctness' },
  parity: { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'Parity' },
  cosmetic: { soft: 'var(--info-soft)', ink: 'var(--info-ink)', label: 'Cosmetic' },
};

/** Token pair for a heatmap cell given its worst severity (null = clean). */
export function cellTokens(worst: string | null): SeverityTokens {
  if (worst && SEVERITY_TOKENS[worst]) return SEVERITY_TOKENS[worst];
  return { soft: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'Clean' };
}

/** Return the worse of two severities (by rank), null-safe. */
export function worseSeverity(a: string | null, b: string | null): string | null {
  const ra = a ? SEVERITY_RANK[a] ?? 0 : 0;
  const rb = b ? SEVERITY_RANK[b] ?? 0 : 0;
  if (ra === 0 && rb === 0) return null;
  return ra >= rb ? a : b;
}

/** "3m ago" / "2h ago" / "5d ago" from an epoch-ms timestamp. */
export function relativeTime(epochMs: number | null): string {
  if (!epochMs) return '—';
  const diff = Date.now() - epochMs;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 8) : '—';
}
