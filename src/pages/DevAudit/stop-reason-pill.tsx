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
  green:   { bg: '#dcfce7', color: '#166534', border: '#86efac' },
  amber:   { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  red:     { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  neutral: { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db' },
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
