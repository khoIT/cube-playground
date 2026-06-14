/**
 * Window toggle for the Ops Console — segmented control (7d / 30d / MTD).
 * Re-scopes the additive Overview tiles + trend charts. Default is 30d.
 * Δ-vs-prior is shown only on the 7d window (Overview decides that — the toggle
 * just owns the selection).
 */
import React from 'react';
import type { OpsWindow } from './ops-window';

export const OPS_WINDOWS: { id: OpsWindow; label: string }[] = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'mtd', label: 'MTD' },
];

interface OpsWindowToggleProps {
  value: OpsWindow;
  onChange: (next: OpsWindow) => void;
}

export function OpsWindowToggle({ value, onChange }: OpsWindowToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Time window"
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 3,
        background: 'var(--bg-muted)',
        borderRadius: 'var(--radius-full)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {OPS_WINDOWS.map((w) => {
        const active = w.id === value;
        return (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(w.id)}
            style={{
              padding: '5px 14px',
              border: 'none',
              borderRadius: 'var(--radius-full)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              background: active ? 'var(--bg-card)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}
