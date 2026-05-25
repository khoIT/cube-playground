/**
 * SearchModeChips — ARIA radiogroup chip group for search mode selection.
 *
 * 3 chips: Turns | Sessions | Cached queries
 * Active chip = n900 bg + n50 text (matches hi-fi mockup .chip.active)
 * Inactive chip = surfaceSubtle bg + n200 border + n700 text
 * Keyboard: ← → cycles through chips; Home/End jump to first/last.
 */

import React, { useRef, KeyboardEvent } from 'react';
import { T } from '../../shell/theme';

export type SearchMode = 'turns' | 'sessions' | 'cached';

const MODES: { value: SearchMode; label: string }[] = [
  { value: 'turns',    label: 'Turns' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'cached',   label: 'Cached queries' },
];

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontFamily: T.fSans,
    fontWeight: 500,
    border: active ? `1px solid ${T.n900}` : `1px solid ${T.n200}`,
    background: active ? T.n900 : T.surfaceSubtle,
    color: active ? T.n50 : T.n700,
    cursor: 'pointer',
    outline: 'none',
    // keep consistent height so layout doesn't shift on selection
    lineHeight: '1.4',
  };
}

interface SearchModeChipsProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}

export function SearchModeChips({ mode, onChange }: SearchModeChipsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % MODES.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + MODES.length) % MODES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MODES.length - 1;
    else return;

    e.preventDefault();
    refs.current[next]?.focus();
    onChange(MODES[next].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Search mode"
      style={{ display: 'flex', gap: 4 }}
    >
      {MODES.map((m, idx) => (
        <button
          key={m.value}
          ref={(el) => { refs.current[idx] = el; }}
          role="radio"
          aria-checked={mode === m.value}
          tabIndex={mode === m.value ? 0 : -1}
          style={chipStyle(mode === m.value)}
          onClick={() => onChange(m.value)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          data-testid={`mode-chip-${m.value}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
