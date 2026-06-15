/**
 * ExperimentGatePrompt — the quality-gate override modal for the manual Explore
 * path. The Drive → Decide view enforces the gate inline (decide-drive-view);
 * the manual Recommendations cards hand a draft straight toward the Command
 * Center, so this modal is the equivalent stop: when a draft fails a CRITICAL
 * quality dimension, the manager must type a reason before proceeding, which is
 * stamped on the draft as `gateOverride`.
 *
 * Reuses the same pure `experimentGateStatus` rule as the Drive path so both
 * surfaces gate identically. tokens.css only.
 */

import React, { useState } from 'react';
import { Btn, CARD_STYLE, EYEBROW_STYLE } from './advisor-primitives';
import { experimentGateStatus, DIMENSION_LABEL } from './experiment-gate';
import type { ExperimentScorecard } from '../../api/advisor';

export function ExperimentGatePrompt({
  scorecard,
  onProceed,
  onCancel,
}: {
  scorecard?: ExperimentScorecard;
  /** Called with the typed override reason when the manager proceeds anyway. */
  onProceed: (reason: string) => void;
  onCancel: () => void;
}) {
  const gate = experimentGateStatus(scorecard);
  const [reason, setReason] = useState('');
  const canOverride = reason.trim().length >= 4;

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.3)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...CARD_STYLE, padding: 22, width: 460, maxWidth: '92vw', fontFamily: 'var(--font-sans)' }}
      >
        <div style={EYEBROW_STYLE}>Quality gate · before you set up</div>

        {/* Dimension chips */}
        {scorecard && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 6px' }}>
            {scorecard.dimensions.map((d) => (
              <span
                key={d.dimension}
                title={d.detail}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 12,
                  fontWeight: 600,
                  background: d.pass ? 'var(--success-soft)' : d.critical ? 'var(--destructive-soft)' : 'var(--warning-soft)',
                  color: d.pass ? 'var(--success-ink)' : d.critical ? 'var(--destructive-ink)' : 'var(--warning-ink)',
                }}
              >
                {d.pass ? '✓' : d.critical ? '✕' : '!'} {DIMENSION_LABEL[d.dimension]}
              </span>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12.5, color: 'var(--destructive-ink)', lineHeight: 1.5, marginTop: 6 }}>
          This experiment fails a quality check that can't be measured around:{' '}
          {gate.criticalFails.map((d) => d.detail).join(' · ')}. Fix it in Explore, or record why you're setting it up anyway.
        </div>

        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why set up despite the failing check? (recorded on the experiment)"
          rows={3}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '8px 10px',
            fontSize: 12.5,
            fontFamily: 'var(--font-sans)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            resize: 'vertical',
          }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <Btn sm onClick={onCancel}>Cancel</Btn>
          <Btn kind="primary" sm disabled={!canOverride} onClick={() => onProceed(reason.trim())}>
            Override &amp; set up anyway →
          </Btn>
        </div>
      </div>
    </div>
  );
}
