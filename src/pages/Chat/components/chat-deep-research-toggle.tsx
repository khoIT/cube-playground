/**
 * DeepResearchToggle — flip-switch + label rendered inside the chat composer.
 * FE-only flag for now; the chat-service treats it as a no-op.
 */
import React from 'react';
import { T } from '../../../shell/theme';

interface DeepResearchToggleProps {
  active: boolean;
  onToggle: () => void;
  /** Slightly smaller geometry for the side-panel surface. */
  compact?: boolean;
}

export function DeepResearchToggle({ active, onToggle, compact }: DeepResearchToggleProps) {
  const TRACK_W = compact ? 32 : 38;
  const TRACK_H = compact ? 18 : 22;
  const KNOB = compact ? 14 : 18;
  const trackBg = active ? T.n900 : T.n200;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? 'Disable Deep Research' : 'Enable Deep Research'}
      title={active ? 'Deep Research: On' : 'Deep Research: Off'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: compact ? 8 : 10,
        border: 'none', background: 'transparent', padding: 0,
        cursor: 'pointer',
        color: T.n800, fontFamily: T.fSans, fontSize: compact ? 12.5 : 14,
      }}
    >
      <span
        aria-hidden
        style={{
          width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2,
          background: trackBg,
          position: 'relative', display: 'inline-block', flexShrink: 0,
          transition: 'background 0.18s',
        }}
      >
        <span
          style={{
            position: 'absolute', top: (TRACK_H - KNOB) / 2,
            left: active ? TRACK_W - KNOB - 2 : 2,
            width: KNOB, height: KNOB, borderRadius: KNOB / 2,
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
            transition: 'left 0.18s',
          }}
        />
      </span>
      Deep Research
    </button>
  );
}
