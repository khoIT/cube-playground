/**
 * StepNav — top horizontal stepper across the 5 experiment-anatomy stages + Decide.
 *
 * Each step shows its fill status from the blueprint slots:
 *   filled (text kept)  → green circle with ✓
 *   touched (kept > 0)  → warning colour "review"
 *   open                → muted "open"
 * Active step uses brand colour.
 */
import React from 'react';
import type { GoalKey, BlueprintSlots } from './advisor-types';
import { STAGES } from './advisor-stage-config';

interface StepNavProps {
  goal: GoalKey;
  /** Index of the currently active stage (–1 when on decide/command screens). */
  activeStageIndex: number;
  slots: BlueprintSlots;
  onGoStage: (i: number) => void;
  onDecide: () => void;
  decideReady: boolean;
}

export function StepNav({
  activeStageIndex,
  slots,
  onGoStage,
  onDecide,
  decideReady,
}: StepNavProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        overflowX: 'auto',
        padding: '2px 0',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {STAGES.map((s, i) => {
        const isCurrent = activeStageIndex === i;
        const slot = slots[s.key];
        const filled = !!slot?.text;
        const touched = (slot?.kept ?? 0) > 0;

        return (
          <React.Fragment key={s.key}>
            <button
              onClick={() => onGoStage(i)}
              style={{
                fontFamily: 'var(--font-sans)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                padding: '4px 6px',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  background: isCurrent
                    ? 'var(--brand)'
                    : filled
                      ? 'var(--success)'
                      : 'var(--bg-muted)',
                  color: isCurrent || filled ? 'var(--text-on-brand)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                {filled ? '✓' : s.emoji}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: isCurrent ? 700 : 600,
                    color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: filled
                      ? 'var(--success-ink)'
                      : touched
                        ? 'var(--warning-ink)'
                        : 'var(--text-muted)',
                  }}
                >
                  {filled ? 'kept' : touched ? 'review' : 'open'}
                </span>
              </span>
            </button>
            {/* Connector line */}
            <span
              style={{
                width: 16,
                height: 1,
                background: 'var(--border-strong)',
                margin: '0 2px',
                flexShrink: 0,
              }}
            />
          </React.Fragment>
        );
      })}

      {/* Decide step */}
      <button
        onClick={onDecide}
        style={{
          fontFamily: 'var(--font-sans)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          padding: '4px 6px',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            background: decideReady ? 'var(--brand)' : 'var(--bg-muted)',
            color: decideReady ? 'var(--text-on-brand)' : 'var(--text-muted)',
            flexShrink: 0,
          }}
        >
          🏁
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: decideReady ? 'var(--brand)' : 'var(--text-muted)',
          }}
        >
          Decide
        </span>
      </button>
    </div>
  );
}
