/**
 * StagePanel — renders all aspect cards for one stage plus the add-angle
 * composer. Also shows a "Investigate this step" batch button and
 * prev/next navigation.
 */
import React from 'react';
import type { Aspect } from './advisor-types';
import { STAGES } from './advisor-stage-config';
import { Btn, CARD_STYLE, EYEBROW_STYLE } from './advisor-primitives';
import { AspectCard } from './aspect-card';
import { AddAngle } from './add-angle-composer';
import type { InvestigationHandlers } from './use-advisor-investigation';

interface StagePanelProps {
  stageIndex: number;
  aspects: Aspect[];
  handlers: InvestigationHandlers;
  isBusy: boolean;
  onGoStage: (i: number) => void;
  onInvestigateAll: () => void;
}

export function StagePanel({
  stageIndex,
  aspects,
  handlers,
  isBusy,
  onGoStage,
  onInvestigateAll,
}: StagePanelProps) {
  const stage = STAGES[stageIndex];
  if (!stage) return null;

  const items = aspects.filter((a) => a.stage === stage.key);
  const kept = items.filter((a) => a.triage === 'keep').length;

  return (
    <div style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Stage header card */}
      <div
        style={{
          ...CARD_STYLE,
          padding: '16px 20px',
          marginBottom: 14,
          background: 'linear-gradient(180deg, var(--bg-muted), var(--bg-card))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22 }}>{stage.emoji}</span>
          <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{stage.q}</h2>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              borderRadius: 'var(--radius-full)',
              padding: '2px 8px',
              background: 'var(--bg-muted)',
              color: 'var(--brand)',
              border: '1px solid var(--border-card)',
              whiteSpace: 'nowrap',
            }}
          >
            builds: {stage.builds}
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '9px 0 0' }}>
          <b>What a strong answer looks like:</b> {stage.good}
        </p>
        <div
          style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: 'var(--text-muted)' }}
        >
          <span>
            <b style={{ color: 'var(--text-secondary)' }}>Toggle</b> = should we look at this?
          </span>
          <span>
            <b style={{ color: 'var(--success-ink)' }}>✓ Keep</b> fills the blueprint ·{' '}
            <b style={{ color: 'var(--warning-ink)' }}>⚑ Flag</b> = open question ·{' '}
            <b style={{ color: 'var(--muted-ink, var(--text-muted))' }}>✕ Rule out</b> = looked,
            doesn't change the plan
          </span>
        </div>
      </div>

      {/* Aspect cards grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {items.map((a) => (
          <AspectCard
            key={a.id}
            a={a}
            onWork={handlers.onWork}
            onTriage={handlers.onTriage}
            onToggle={handlers.onToggle}
            onOpen={handlers.onOpen}
            onRefine={handlers.onRefine}
            onCancelEdit={handlers.onCancelEdit}
            onResubmit={handlers.onResubmit}
            onProvideInfo={handlers.onProvideInfo}
          />
        ))}
        <AddAngle stage={stage} onAdd={handlers.onAdd} onAssert={handlers.onAssert} />
      </div>

      {/* Footer: prev/next + status */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 18,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Btn
          sm
          onClick={() => onGoStage(Math.max(0, stageIndex - 1))}
          disabled={stageIndex === 0}
        >
          {stageIndex > 0 ? `← ${STAGES[stageIndex - 1].label}` : '←'}
        </Btn>

        <span
          style={{
            fontSize: 12.5,
            color: kept > 0 ? 'var(--success-ink)' : 'var(--text-muted)',
          }}
        >
          {kept > 0
            ? `✓ ${kept} kept for this block`
            : 'Keep at least one finding to fill this block of the experiment'}
        </span>

        <Btn kind="primary" sm onClick={() => onGoStage(stageIndex + 1)}>
          {stageIndex < STAGES.length - 1 ? `${STAGES[stageIndex + 1].label} →` : 'Decide →'}
        </Btn>
      </div>
    </div>
  );
}
