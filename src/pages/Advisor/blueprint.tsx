/**
 * Blueprint strip — assembles the experiment sentence from kept findings.
 *
 * Empty slots render as jump-buttons so the manager can navigate directly
 * to the stage that needs filling. The sentence template alternates plain
 * text and stage-key slots (see GOAL_TEMPLATES).
 */
import React from 'react';
import type { GoalKey, BlueprintSlots } from './advisor-types';
import { STAGES, GOAL_TEMPLATES } from './advisor-stage-config';
import { CARD_STYLE, EYEBROW_STYLE } from './advisor-primitives';

interface BlueprintProps {
  goal: GoalKey;
  slots: BlueprintSlots;
  /** Called when a slot jump-button or filled-slot is clicked. */
  onJump?: (stageKey: string) => void;
  /** Compact variant used inside the Command Center thesis card. */
  compact?: boolean;
}

export function Blueprint({ goal, slots, onJump, compact }: BlueprintProps) {
  const template = GOAL_TEMPLATES[goal].sentence;
  const stageKeys = new Set<string>(STAGES.map((s) => s.key));

  return (
    <div
      style={{
        ...CARD_STYLE,
        padding: compact ? '12px 15px' : '15px 18px',
        background: 'linear-gradient(180deg, var(--bg-muted), var(--bg-card))',
      }}
    >
      {!compact && (
        <div style={{ ...EYEBROW_STYLE, marginBottom: 7 }}>
          Your experiment so far — built from what you keep
        </div>
      )}
      <div style={{ fontSize: compact ? 14 : 15.5, lineHeight: 1.7, fontFamily: 'var(--font-sans)' }}>
        {template.map((part, i) => {
          if (!stageKeys.has(part as string)) {
            return <span key={i}>{part}</span>;
          }
          // This part is a stage key
          const stage = STAGES.find((s) => s.key === part)!;
          const slot = slots[stage.key as keyof BlueprintSlots];

          if (slot?.text) {
            return (
              <span
                key={i}
                onClick={() => onJump?.(stage.key)}
                title={`from ${stage.label}`}
                style={{
                  fontWeight: 700,
                  color: 'var(--brand)',
                  cursor: onJump ? 'pointer' : 'default',
                  borderBottom: '2px solid var(--bg-muted)',
                }}
              >
                {slot.text}
              </span>
            );
          }

          // Empty slot — render as a jump button
          return (
            <button
              key={i}
              onClick={() => onJump?.(stage.key)}
              title={`Fill from the ${stage.label} step`}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'inherit',
                fontWeight: 600,
                color: 'var(--text-muted)',
                background: 'var(--bg-muted)',
                border: '1px dashed var(--border-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px 1px 6px',
                cursor: onJump ? 'pointer' : 'default',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ marginRight: 3 }}>{stage.emoji}</span>
              <span
                style={{
                  fontSize: '0.82em',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  opacity: 0.8,
                }}
              >
                {stage.label}
              </span>{' '}
              <span style={{ opacity: 0.75 }}>{stage.slotEmpty}</span>
              {onJump && ' →'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
