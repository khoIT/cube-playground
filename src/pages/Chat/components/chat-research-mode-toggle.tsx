/**
 * ResearchModeToggle — flip-switch rendered inside the chat composer.
 * When ON, the turn enables both web search and research mode (subject to
 * CHAT_ENABLE_WEB_SEARCH and CHAT_ENABLE_RESEARCH_MODE env master flags on
 * the chat-service). Sends X-Research-Mode: 1 per turn.
 */
import React from 'react';
import { T } from '../../../shell/theme';

interface ResearchModeToggleProps {
  active: boolean;
  onToggle: () => void;
  /** Slightly smaller geometry for the side-panel surface. */
  compact?: boolean;
}

export function ResearchModeToggle({ active, onToggle, compact }: ResearchModeToggleProps) {
  const TRACK_W = compact ? 32 : 38;
  const TRACK_H = compact ? 18 : 22;
  const KNOB = compact ? 14 : 18;
  const trackBg = active ? T.n900 : T.n200;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? 'Disable Research mode' : 'Enable Research mode'}
      title={active ? 'Research mode: On' : 'Research mode: Off'}
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
      Research mode
    </button>
  );
}
