/**
 * Drive → Decide view. When a Drive (live AI) investigation finishes, its
 * self-describing draft lands here so both postures converge on Decide before
 * the Command Center. Renders the agent's 5-slot causal chain (Opportunity →
 * Target → Cause → Lever → Proof) and the pre-registered "what to look for"
 * readout, then hands the (split-adjusted) draft on. Nothing launches here.
 */

import React, { useState } from 'react';
import { STAGES } from './advisor-stage-config';
import { Btn, CARD_STYLE, EYEBROW_STYLE } from './advisor-primitives';
import type { StageKey } from './advisor-types';
import type { DriveArtifact } from './drive-artifact';
import type { ExperimentDraft } from '../../api/advisor';

/**
 * Re-split a draft's arms to the manager's chosen treatment share before
 * hand-off — and re-stamp the pre-registered readout so its hold-out figure and
 * decision rule never contradict the actual arm split.
 */
function withSplit(draft: ExperimentDraft, treatmentPct: number): ExperimentDraft {
  const treatmentShare = treatmentPct / 100;
  const holdoutShare = parseFloat((1 - treatmentShare).toFixed(4));
  const holdoutPct = Math.round(holdoutShare * 100);
  return {
    ...draft,
    arms: [
      { key: 'treatment', label: 'Treatment', share: treatmentShare },
      { key: 'holdout', label: 'Hold-out (measured)', share: holdoutShare },
    ],
    readout: {
      ...draft.readout,
      holdoutPct,
      decisionRule: draft.readout.decisionRule.replace(/\d+% hold-out/, `${holdoutPct}% hold-out`),
    },
  };
}

export function DecideDriveView({
  artifact,
  onBack,
  onHandoff,
}: {
  artifact: DriveArtifact;
  onBack: () => void;
  onHandoff: (draft: ExperimentDraft) => void;
}) {
  const { draft } = artifact;
  const slots: Record<StageKey, string> = {
    opportunity: draft.blueprint.opportunity,
    target: draft.blueprint.target,
    cause: draft.blueprint.cause,
    lever: draft.blueprint.lever,
    proof: draft.blueprint.proof,
  };

  // Seed the split slider from the draft's treatment arm; clamp 70–85.
  const seeded = Math.round((draft.arms.find((a) => a.key === 'treatment')?.share ?? 0.8) * 100);
  const [split, setSplit] = useState(Math.min(85, Math.max(70, seeded)));
  const reachableN = draft.cohort.addressableN;
  const treatN = Math.round(reachableN * (split / 100));
  const holdN = reachableN - treatN;

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={EYEBROW_STYLE}>Decide · the experiment your AI investigation proposed</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '5px 0 0', lineHeight: 1.2 }}>
            Here's the experiment the advisor built
          </h1>
        </div>
        <Btn sm onClick={onBack}>← Back to the investigation</Btn>
      </div>

      {/* 5-slot causal chain, agent-filled */}
      <div style={{ ...CARD_STYLE, marginBottom: 14 }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-card)', fontWeight: 600, fontSize: 13.5 }}>
          Opportunity → Target → Cause → Lever → Proof
        </div>
        {STAGES.map((s, i) => (
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
              <div style={{ fontSize: 13.5, marginTop: 3, color: 'var(--text-primary)' }}>
                {slots[s.key] || <span style={{ color: 'var(--warning-ink)' }}>not specified</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* What to look for — the pre-registered readout rule */}
      <div style={{ ...CARD_STYLE, padding: '14px 18px', marginBottom: 14, borderColor: 'var(--brand)', borderWidth: 2 }}>
        <div style={EYEBROW_STYLE}>What to look for · pre-registered</div>
        <div style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 4px', color: 'var(--text-primary)' }}>
          {draft.readout.decisionRule}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <Chip label="Primary metric" value={draft.readout.primaryMetric} />
          <Chip label="Min. detectable" value={`≥ ${draft.readout.mde} pp`} />
          <Chip label="Horizon" value={`${draft.readout.horizonDays} d`} />
          <Chip label="Hold-out" value={`${draft.readout.holdoutPct}%`} />
        </div>
      </div>

      {/* Split slider */}
      <div style={{ ...CARD_STYLE, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            Treatment vs hold-out{' '}
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>
              — nothing launches until you say so
            </span>
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{split}% / {100 - split}%</span>
        </div>
        <input type="range" min={70} max={85} value={split} onChange={(e) => setSplit(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--brand)' }} />
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6 }}>
          ≈ {treatN.toLocaleString()} get the action · ≈ {holdN.toLocaleString()} held back for comparison.
        </div>
      </div>

      {/* Safety */}
      <div style={{ ...CARD_STYLE, padding: '11px 15px', marginBottom: 16, background: 'var(--info-soft)', fontSize: 12.5, color: 'var(--info-ink)' }}>
        🛟 Hold-out measured · won't contact players who paid within {draft.safety.recentPayerGuardDays}d · {draft.safety.contactCapPerPlayer} contact/player · delivery via {draft.delivery === 'cs-queue' ? 'CS work queue' : 'external/manual'}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Btn onClick={onBack}>Back</Btn>
        <Btn kind="primary" onClick={() => onHandoff(withSplit(draft, split))}>
          Review &amp; set up experiment →
        </Btn>
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', padding: '6px 12px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
    </span>
  );
}
