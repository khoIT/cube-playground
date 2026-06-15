/**
 * ComposerToolToggle — flip-switch + label for the chat composer action row.
 *
 * Restores the original toggle-switch look (track + sliding knob) and is used
 * once per tool: "Web Search" and "DeepThink". Each is independently
 * controlled; backend gating is per-toggle (X-Web-Search / X-Research-Mode).
 *
 * Props:
 *   active   — controlled on/off state
 *   onToggle — flip callback
 *   label    — visible text to the right of the switch
 *   title    — tooltip + aria-label
 *   compact  — tighter geometry for the narrower side-pane surface
 */
import React from 'react';
import { T } from '../../../shell/theme';

interface ComposerToolToggleProps {
  active: boolean;
  onToggle: () => void;
  label: string;
  title: string;
  compact?: boolean;
}

export function ComposerToolToggle({
  active,
  onToggle,
  label,
  title,
  compact,
}: ComposerToolToggleProps) {
  const TRACK_W = compact ? 32 : 38;
  const TRACK_H = compact ? 18 : 22;
  const KNOB = compact ? 14 : 18;
  const trackBg = active ? 'var(--shell-text)' : 'var(--shell-border)';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={title}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 8 : 10,
        border: 'none',
        background: 'transparent',
        padding: 0,
        cursor: 'pointer',
        color: 'var(--shell-text-emphasis)',
        fontFamily: T.fSans,
        fontSize: compact ? 12.5 : 14,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: TRACK_H / 2,
          background: trackBg,
          position: 'relative',
          display: 'inline-block',
          flexShrink: 0,
          transition: 'background 0.18s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: (TRACK_H - KNOB) / 2,
            left: active ? TRACK_W - KNOB - 2 : 2,
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB / 2,
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
            transition: 'left 0.18s',
          }}
        />
      </span>
      {label}
    </button>
  );
}
