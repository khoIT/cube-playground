/**
 * StarterTopicFilter — chip group above the starter grid.
 * Selecting a publishing-business topic (LiveOps / User Acquisition /
 * Monetization) filters the starter pool by `topicTags`.
 */
import React from 'react';
import { T } from '../../../shell/theme';
import {
  STARTER_TOPICS,
  STARTER_TOPIC_LABELS,
  STARTER_TOPIC_COLORS,
  type StarterTopic,
} from '../library/starter-questions';

export type StarterTopicFilterValue = 'all' | StarterTopic;

const OPTIONS: ReadonlyArray<{ value: StarterTopicFilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  ...STARTER_TOPICS.map((t) => ({ value: t, label: STARTER_TOPIC_LABELS[t] })),
];

interface Props {
  value: StarterTopicFilterValue;
  onChange: (value: StarterTopicFilterValue) => void;
}

export function StarterTopicFilter({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Starter topic filter"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        // Topic chips take their semantic accent when active; "All" keeps the
        // neutral inverse style.
        const accent = opt.value !== 'all' ? STARTER_TOPIC_COLORS[opt.value] : null;
        const activeStyle = accent
          ? { border: `1px solid ${accent.ink}`, background: accent.soft, color: accent.ink }
          : { border: `1px solid var(--shell-text)`, background: 'var(--shell-text)', color: '#fff' };
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '4px 12px',
              borderRadius: 999,
              fontFamily: T.fSans,
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              ...(active
                ? activeStyle
                : { border: `1px solid var(--shell-border-strong)`, background: 'transparent', color: 'var(--shell-text-secondary)' }),
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
