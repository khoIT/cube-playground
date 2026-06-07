/**
 * Soft categorical chip for 360 sections — semantic *-soft/*-ink token pairs
 * (dark-mode safe). Tone picked explicitly or derived from a status value.
 */

import { ReactElement, ReactNode } from 'react';

export type ChipTone = 'muted' | 'info' | 'success' | 'warning';

const TONES: Record<ChipTone, { bg: string; ink: string }> = {
  muted: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
  info: { bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  success: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  warning: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
};

/**
 * Status-value tone heuristic: active lifecycles read healthy (green), churn-ish
 * states and high-intensity engagement read warm (amber), the rest stay neutral.
 */
export function toneForStatus(value: string): ChipTone {
  const v = value.toLowerCase();
  if (/active/.test(v)) return 'success';
  if (/churn|lapse|dormant|risk|hardcore|core/.test(v)) return 'warning';
  return 'muted';
}

export function SoftChip({ tone = 'muted', icon, children }: { tone?: ChipTone; icon?: string; children: ReactNode }): ReactElement {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        fontWeight: 600,
        padding: '2px 10px',
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        background: t.bg,
        color: t.ink,
      }}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}
