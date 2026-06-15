/**
 * Shared atoms + formatters for the Care tab widgets — a soft/ink chip, star
 * rating, and VND / percent formatters. Kept tiny and token-only so every Care
 * widget renders identically and inherits dark-mode for free.
 */

import { ReactElement } from 'react';

type Tone = 'neg' | 'pos' | 'neu' | 'warn' | 'info';

const TONE: Record<Tone, { bg: string; ink: string }> = {
  neg: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)' },
  pos: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  neu: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
  warn: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
  info: { bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
};

export function Chip({ children, tone }: { children: string; tone: Tone }): ReactElement {
  return (
    <span
      style={{
        background: TONE[tone].bg,
        color: TONE[tone].ink,
        borderRadius: 'var(--radius-full)',
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}
    >
      {children}
    </span>
  );
}

/** Map CS sentiment label → chip tone (null sentiment renders nothing). */
export function sentimentTone(sentiment: string | null): Tone {
  if (sentiment === 'Negative') return 'neg';
  if (sentiment === 'Positive') return 'pos';
  return 'neu';
}

/** Map a CS status group → chip tone. */
export function statusTone(status: string | null): Tone {
  if (status === 'Closed') return 'pos';
  if (status === 'Rejected') return 'neu';
  if (status === 'Processing') return 'info';
  return 'warn'; // New / Waiting* / Reopen / Waiting for Task — still in flight
}

export function Stars({ rating }: { rating: number | null }): ReactElement {
  if (rating == null) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
  const full = Math.round(rating);
  return (
    <span style={{ color: 'var(--warning-ink)', letterSpacing: 1, fontSize: 12 }} title={`${rating.toFixed(1)} / 5`}>
      {'★'.repeat(full)}
      <span style={{ color: 'var(--fill-faint)' }}>{'★'.repeat(Math.max(0, 5 - full))}</span>
    </span>
  );
}

/** Compact VND: ₫184.2M / ₫92.7K / ₫0. */
export function fmtVnd(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `₫${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `₫${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `₫${(v / 1e3).toFixed(1)}K`;
  return `₫${Math.round(v)}`;
}

/** Signed percent: +12% / −31% / 0%; null → em dash. */
export function fmtPct(p: number | null): string {
  if (p == null) return '—';
  const sign = p > 0 ? '+' : p < 0 ? '−' : '';
  return `${sign}${Math.abs(p).toFixed(0)}%`;
}
