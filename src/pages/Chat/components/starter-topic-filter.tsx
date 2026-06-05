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
