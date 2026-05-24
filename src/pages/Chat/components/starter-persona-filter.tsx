/**
 * StarterPersonaFilter — chip group above the starter grid.
 * Selecting a persona filters `STARTER_QUESTIONS` by `personaTags`.
 */
import React from 'react';
import { T } from '../../../shell/theme';
import type { StarterPersona } from '../library/starter-questions';

export type StarterPersonaFilterValue = 'all' | StarterPersona;

const OPTIONS: ReadonlyArray<{ value: StarterPersonaFilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pm', label: 'PM' },
  { value: 'marketer', label: 'Marketer' },
  { value: 'analyst', label: 'Analyst' },
];

interface Props {
  value: StarterPersonaFilterValue;
  onChange: (value: StarterPersonaFilterValue) => void;
}

export function StarterPersonaFilter({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Starter persona filter"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '4px 12px',
              border: `1px solid ${active ? T.n900 : T.n300}`,
              background: active ? T.n900 : 'transparent',
              color: active ? '#fff' : T.n700,
              borderRadius: 999,
              fontFamily: T.fSans,
              fontSize: 12,
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
