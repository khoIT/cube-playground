/**
 * LegacyTurnBadge — small pill shown on turns that predate the observability feature.
 * No per-step LLM call / tool data was captured for these turns.
 */
import React from 'react';
import { T } from '../../shell/theme';

export function LegacyTurnBadge() {
  return (
    <span
      title="Pre-feature turn — no per-step observability data captured"
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        background: 'var(--shell-warning-soft)',
        color: 'var(--shell-warning)',
        border: `1px solid var(--shell-warning)`,
        lineHeight: '18px',
        flexShrink: 0,
      }}
    >
      Legacy
    </span>
  );
}
