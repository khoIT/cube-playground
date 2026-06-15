/**
 * StopReasonPill — colored badge indicating why an LLM turn ended.
 *
 * Color mapping (per phase-02 spec):
 *   end_turn       → green  (clean completion)
 *   tool_use       → amber  (handed off to a tool)
 *   max_tokens     → red    (truncated)
 *   refusal        → red    (safety block)
 *   pause_turn     → red    (paused mid-turn)
 *   stop_sequence  → neutral (custom stop)
 *   null / unknown → neutral (—)
 */
import React from 'react';

type PillVariant = 'green' | 'amber' | 'red' | 'neutral';

const PILL_COLORS: Record<PillVariant, { bg: string; color: string; border: string }> = {
  green:   { bg: 'var(--success-soft)', color: 'var(--success-ink)', border: 'var(--success-border)' },
  amber:   { bg: 'var(--warning-soft)', color: 'var(--warning-ink)', border: 'var(--warning-border)' },
  red:     { bg: 'var(--destructive-soft)', color: 'var(--destructive-ink)', border: 'var(--destructive-border)' },
  neutral: { bg: 'var(--bg-muted)', color: 'var(--text-muted)', border: 'var(--border-card)' },
};

function getVariant(stopReason: string | null): PillVariant {
  if (!stopReason) return 'neutral';
  switch (stopReason) {
    case 'end_turn':     return 'green';
    case 'tool_use':     return 'amber';
    case 'max_tokens':
    case 'refusal':
    case 'pause_turn':   return 'red';
    default:             return 'neutral';
  }
}

interface StopReasonPillProps {
  value: string | null;
}

export function StopReasonPill({ value }: StopReasonPillProps) {
  const variant = getVariant(value);
  const { bg, color, border } = PILL_COLORS[variant];
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: 10,
      fontSize: 10,
      fontWeight: 600,
      background: bg,
      color,
      border: `1px solid ${border}`,
      whiteSpace: 'nowrap',
    }}>
      {value ?? '—'}
    </span>
  );
}
