/**
 * GoalScreen — entry point for an Advisor investigation.
 *
 * Two phases:
 *   'ask'  — NL text box + goal chips + Revenue/Engagement toggle
 *   'echo' — editable interpretation confirm before digging
 *             ("Got it — among <cohort>, grow <goal>. Right?")
 *
 * The echo phase prevents mis-parse: the manager edits the cohort inline
 * and confirms before the 5-stage builder opens.
 */
import React, { useState } from 'react';
import type { GoalKey } from './advisor-types';
import { GOAL_TEMPLATES, GOAL_CHIPS } from './advisor-stage-config';
import { Btn, CARD_STYLE, EYEBROW_STYLE, PulsingRow } from './advisor-primitives';

interface GoalScreenProps {
  onSetup: (goal: GoalKey, goalText: string) => void;
}

export function GoalScreen({ onSetup }: GoalScreenProps) {
  const [text, setText] = useState('Get my lapsing whales paying again — and tell me what to do about it');
  const [goal, setGoal] = useState<GoalKey>('revenue');
  const [phase, setPhase] = useState<'ask' | 'echo'>('ask');
  const [cohort, setCohort] = useState('Lapsing whales');
  const [filling, setFilling] = useState(false);

  const dig = () => {
    setFilling(true);
    setTimeout(() => onSetup(goal, text), 1000);
  };

  // ── Echo (confirm interpretation) ─────────────────────────────────────────
  if (phase === 'echo') {
    return (
      <div style={{ maxWidth: 660, margin: '0 auto', paddingTop: 40, fontFamily: 'var(--font-sans)' }}>
        <div style={EYEBROW_STYLE}>Before I dig — did I get this right?</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 16px', lineHeight: 1.2 }}>
          Here's what I understood
        </h1>

        <div
          style={{
            ...CARD_STYLE,
            padding: '18px 20px',
            borderColor: 'var(--brand)',
            borderWidth: 2,
          }}
        >
          <div style={{ fontSize: 15, lineHeight: 1.7 }}>
            Among{' '}
            <input
              value={cohort}
              onChange={(e) => setCohort(e.target.value)}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--brand)',
                border: 'none',
                borderBottom: '2px solid var(--border-card)',
                outline: 'none',
                background: 'transparent',
                minWidth: 120,
                width: Math.min(420, cohort.length * 9 + 30),
              }}
            />
            , find a way to{' '}
            <b style={{ color: 'var(--brand)' }}>
              {goal === 'revenue' ? 'grow revenue' : 'get them playing more'}
            </b>
            {goal === 'engagement' && (
              <span style={{ color: 'var(--text-muted)' }}> (the signal before they stop paying)</span>
            )}
            .
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
            From your words: "{text}". Optimising for{' '}
            <b>{GOAL_TEMPLATES[goal].label}</b> — change the toggle below if that's off.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {(Object.keys(GOAL_TEMPLATES) as GoalKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setGoal(k)}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '5px 11px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  border: `1px solid ${goal === k ? 'var(--brand)' : 'var(--border-strong)'}`,
                  background: goal === k ? 'var(--bg-muted)' : 'var(--bg-card)',
                  color: goal === k ? 'var(--brand)' : 'var(--text-secondary)',
                }}
              >
                {GOAL_TEMPLATES[k].label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <Btn kind="primary" onClick={dig} disabled={filling}>
            {filling ? 'Digging…' : 'Looks right — dig in →'}
          </Btn>
          <Btn onClick={() => setPhase('ask')} disabled={filling}>
            ← Fix the goal
          </Btn>
        </div>

        {filling && (
          <div
            style={{
              marginTop: 18,
              padding: '14px 16px',
              ...CARD_STYLE,
              background: 'var(--bg-muted)',
            }}
          >
            <PulsingRow>
              <span style={{ fontSize: 16 }}>✨</span>
              <span style={{ fontSize: 13.5 }}>
                Reading {cohort} · laying out the opportunity, target, cause, lever and proof to
                check…
              </span>
            </PulsingRow>
          </div>
        )}
      </div>
    );
  }

  // ── Ask (main entry) ───────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingTop: 34, fontFamily: 'var(--font-sans)' }}>
      <div style={EYEBROW_STYLE}>Optimization Advisor</div>
      <h1 style={{ fontSize: 25, fontWeight: 700, margin: '8px 0 6px', lineHeight: 1.2 }}>
        What are you trying to figure out?
      </h1>
      <p style={{ fontSize: 14.5, color: 'var(--text-secondary)', margin: '0 0 18px', lineHeight: 1.55 }}>
        Say it in plain words. The Advisor builds an <b>experiment, step by step</b> — first the
        opportunity, then who, why, what to do, and whether it'll work. It digs; you keep what
        matters.
      </p>

      {/* NL input */}
      <div
        style={{
          ...CARD_STYLE,
          padding: '6px 6px 6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderColor: 'var(--brand)',
          borderWidth: 2,
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          style={{
            flex: 1,
            fontFamily: 'var(--font-sans)',
            fontSize: 15,
            border: 'none',
            outline: 'none',
            resize: 'none',
            padding: '8px 0',
            background: 'transparent',
            color: 'var(--text-primary)',
          }}
        />
        <Btn kind="primary" onClick={() => setPhase('echo')}>
          Build the experiment →
        </Btn>
      </div>

      {/* Quick-pick chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {GOAL_CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => {
              setText(c);
              setGoal(/play|engag/i.test(c) ? 'engagement' : 'revenue');
            }}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12.5,
              padding: '7px 12px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Goal toggle */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Optimising for:</span>
        {(Object.keys(GOAL_TEMPLATES) as GoalKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setGoal(k)}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12.5,
              fontWeight: 600,
              padding: '7px 13px',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              border: `1px solid ${goal === k ? 'var(--brand)' : 'var(--border-strong)'}`,
              background: goal === k ? 'var(--bg-muted)' : 'var(--bg-card)',
              color: goal === k ? 'var(--brand)' : 'var(--text-secondary)',
            }}
          >
            {GOAL_TEMPLATES[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}
