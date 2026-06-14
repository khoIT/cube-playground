/**
 * DecideScreen — blueprint → experiment mapping + editable reversible draft.
 *
 * Grade, don't gate: shows "Strong" vs "Exploratory" banner based on
 * completeness and confidence — never blocks the manager from proceeding.
 *
 * Split slider is clamped 70–85 so hold-out is always ≥15%.
 * "Nothing launches until you say so" is prominent.
 */
import React from 'react';
import type { Aspect, GoalKey, BlueprintSlots } from './advisor-types';
import { STAGES } from './advisor-stage-config';
import { Blueprint } from './blueprint';
import { Btn, CARD_STYLE, EYEBROW_STYLE } from './advisor-primitives';

interface DecideScreenProps {
  goal: GoalKey;
  aspects: Aspect[];
  blueprintSlots: BlueprintSlots;
  split: number;
  setSplit: (n: number) => void;
  onBack: () => void;
  onGoStage: (i: number) => void;
  onSend: () => void;
  setOpenId: (id: string) => void;
}

export function DecideScreen({
  goal,
  aspects,
  blueprintSlots,
  split,
  setSplit,
  onBack,
  onGoStage,
  onSend,
  setOpenId,
}: DecideScreenProps) {
  const missing = STAGES.filter((s) => !blueprintSlots[s.key]?.text);
  const lever = aspects.find((a) => a.stage === 'lever' && a.triage === 'keep');

  // Grade: all slots filled + ≤1 estimate = "Strong"; otherwise "Exploratory"
  const kept = aspects.filter((a) => a.triage === 'keep');
  const estimates = kept.filter((a) => a.conf === 'med').length;
  const isStrong = missing.length === 0 && estimates <= 1;

  // Illustrative cohort size (demo — real data comes from diagnosis)
  const reachableN = 1872;
  const treatN = Math.round(reachableN * (split / 100));
  const holdN = reachableN - treatN;

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <div style={EYEBROW_STYLE}>Decide · your investigation, assembled into an experiment</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '5px 0 0', lineHeight: 1.2 }}>
            Here's the experiment you built
          </h1>
        </div>
        <Btn sm onClick={onBack}>
          ← Back to the board
        </Btn>
      </div>

      {/* Blueprint — large, traceable */}
      <div style={{ marginBottom: 8 }}>
        <Blueprint
          goal={goal}
          slots={blueprintSlots}
          onJump={(key) => {
            const idx = STAGES.findIndex((s) => s.key === key);
            if (idx >= 0) onGoStage(idx);
          }}
        />
      </div>

      {/* Incomplete warning */}
      {missing.length > 0 && (
        <div
          style={{
            ...CARD_STYLE,
            padding: '11px 15px',
            marginBottom: 10,
            background: 'var(--warning-soft)',
            borderColor: 'var(--warning)',
            fontSize: 12.5,
            color: 'var(--warning-ink)',
          }}
        >
          ⚠ Incomplete: you haven't kept a finding for{' '}
          <b>{missing.map((m) => m.label).join(', ')}</b>.{' '}
          {missing.some((m) => m.key === 'cause') &&
            'Without a cause, your lever is a guess. '}
          <button
            onClick={onBack}
            style={{
              fontFamily: 'var(--font-sans)',
              border: 'none',
              background: 'none',
              color: 'var(--warning-ink)',
              fontWeight: 700,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            go fill it →
          </button>
        </div>
      )}

      {/* Grade banner — never blocks */}
      <div
        style={{
          ...CARD_STYLE,
          padding: '11px 15px',
          marginBottom: 14,
          background: isStrong ? 'var(--success-soft)' : 'var(--warning-soft)',
          borderColor: isStrong ? 'var(--success)' : 'var(--warning)',
          fontSize: 12.5,
          color: isStrong ? 'var(--success-ink)' : 'var(--warning-ink)',
          display: 'flex',
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 700 }}>{isStrong ? '✓ Strong' : '◐ Exploratory'}</span>
        <span>
          {isStrong
            ? 'every block is filled and mostly measured — a result you can defend.'
            : `built on ${missing.length ? `${missing.length} gap(s) and ` : ''}${estimates} estimate(s). You can still run it — you'll learn — but expect surprises, not a sure thing.`}
        </span>
      </div>

      {/* Slot-by-slot traceability */}
      <div style={{ ...CARD_STYLE, marginBottom: 16 }}>
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border-card)',
            fontWeight: 600,
            fontSize: 13.5,
          }}
        >
          How each step shaped this experiment
        </div>
        {STAGES.map((s, i) => {
          const supporting = aspects.filter(
            (a) => a.stage === s.key && a.triage === 'keep',
          );
          return (
            <div
              key={s.key}
              style={{
                padding: '12px 18px',
                borderBottom: i < STAGES.length - 1 ? '1px solid var(--bg-muted)' : 'none',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              <span style={{ fontSize: 16, width: 24, flexShrink: 0 }}>{s.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                  {s.label} → {s.builds}
                </div>
                {supporting.length ? (
                  supporting.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => setOpenId(a.id)}
                      style={{ fontSize: 13, marginTop: 3, cursor: 'pointer' }}
                    >
                      <b style={{ color: 'var(--brand)' }}>{a.slot || '✓'}</b>{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>— {a.finding}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12.5, color: 'var(--warning-ink)', marginTop: 3 }}>
                    nothing kept — this block is a guess
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Expected result card */}
      <div
        style={{
          ...CARD_STYLE,
          padding: '16px 20px',
          borderColor: 'var(--brand)',
          borderWidth: 2,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'baseline',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            {lever ? lever.q : '(pick a lever first)'}
          </span>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--brand)' }}>
            {goal === 'revenue' ? '+312M₫' : '+ playtime → revenue'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 0' }}>
          <div
            style={{
              padding: '8px 13px',
              background: 'var(--success-soft)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12.5,
              color: 'var(--success-ink)',
            }}
          >
            📏 Big enough for a clear answer in 14 days
          </div>
          <div
            style={{
              padding: '8px 13px',
              background: 'var(--info-soft)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12.5,
              color: 'var(--info-ink)',
            }}
          >
            🛟 Won't contact recent payers · hold-out measured · 1 contact/player
          </div>
        </div>
      </div>

      {/* Split slider */}
      <div style={{ ...CARD_STYLE, padding: '16px 18px', marginBottom: 18 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            Treatment vs hold-out{' '}
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>
              — nothing launches until you say so
            </span>
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            {split}% / {100 - split}%
          </span>
        </div>
        <input
          type="range"
          min={70}
          max={85}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--brand)' }}
        />
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6 }}>
          ≈ {treatN.toLocaleString()} get the action · ≈ {holdN.toLocaleString()} held back for
          comparison.
        </div>
        <div
          style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}
        >
          We always hold <b>at least 15%</b> back, untouched, so we can prove the win-back{' '}
          <i>caused</i> the recovery — not the whales who'd have returned anyway. That gap is the
          lift you can defend to your boss.
        </div>
      </div>

      {/* CTA */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Btn onClick={onBack}>Back to board</Btn>
        <Btn kind="primary" onClick={onSend} disabled={!lever}>
          Review &amp; set up experiment →
        </Btn>
      </div>
    </div>
  );
}
