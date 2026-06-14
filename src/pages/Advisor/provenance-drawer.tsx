/**
 * ProvenanceDrawer — slide-in panel showing evidence + triage for one aspect.
 *
 * The "glass-box" contract: every number can be traced to an "Open in Playground"
 * deep-link so an analyst can verify the exact query. Because no PlaygroundLink is
 * attached to the demo aspects (live Cube not available), we show the source info
 * and a disabled deep-link with a clear explanation.
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import type { Aspect } from './advisor-types';
import { STAGES, TRIAGE_CONFIG, CONF_CONFIG } from './advisor-stage-config';
import { Btn, EYEBROW_STYLE } from './advisor-primitives';
import type { InvestigationHandlers } from './use-advisor-investigation';
import type { PlaygroundLink } from '../../api/advisor';
import { buildQueryDeeplink } from '../../utils/playground-deeplink';

interface ProvenanceDrawerProps {
  aspect: Aspect | null;
  playgroundLink?: PlaygroundLink | null;
  onClose: () => void;
  onTriage: InvestigationHandlers['onTriage'];
}

export function ProvenanceDrawer({
  aspect,
  playgroundLink,
  onClose,
  onTriage,
}: ProvenanceDrawerProps) {
  const history = useHistory();

  if (!aspect) return null;

  const stage = STAGES.find((s) => s.key === aspect.stage);
  const conf = CONF_CONFIG[aspect.conf];

  const openInPlayground = () => {
    if (!playgroundLink) return;
    // Build a minimal Cube query from the PlaygroundLink metadata
    const query: Record<string, unknown> = {
      measures: playgroundLink.measures,
      dimensions: playgroundLink.dimensions ?? [],
      filters: playgroundLink.filters ?? [],
      limit: playgroundLink.rows ?? 100,
    };
    const url = buildQueryDeeplink(query);
    history.push(url.startsWith('#') ? url.slice(1) : url);
  };

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.25)',
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: '93vw',
          height: '100%',
          background: 'var(--bg-card)',
          padding: 24,
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <div style={EYEBROW_STYLE}>
            {stage?.emoji} {stage?.label} · discovery
          </div>
          <Btn sm onClick={onClose}>
            Close
          </Btn>
        </div>

        {/* Question */}
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 12px', lineHeight: 1.3 }}>
          {aspect.q}
        </h3>

        {/* Finding */}
        <div
          style={{
            padding: '15px 16px',
            background: 'var(--bg-muted)',
            borderRadius: 'var(--radius-md)',
            fontSize: 14.5,
            lineHeight: 1.55,
            marginBottom: 14,
          }}
        >
          {aspect.finding || <span style={{ color: 'var(--text-muted)' }}>Investigation not yet run.</span>}
        </div>

        {/* Blueprint contribution */}
        {stage && (
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--bg-muted)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12.5,
              marginBottom: 16,
            }}
          >
            <b>What this decides in your experiment:</b> {stage.builds}.
            {aspect.slot && (
              <>
                {' '}
                Keep it and the blueprint reads "…{aspect.slot}…".
              </>
            )}
          </div>
        )}

        {/* Basis note */}
        {aspect.basis && (
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--warning-soft)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              color: 'var(--warning-ink)',
              marginBottom: 14,
            }}
          >
            📎 {aspect.basis}
          </div>
        )}

        {/* Confidence */}
        <div style={{ ...EYEBROW_STYLE, marginBottom: 8 }}>How sure are we</div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            background: conf.bg,
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 600,
            color: conf.ink,
            marginBottom: 8,
          }}
        >
          {conf.label}
        </div>
        <div
          style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 12 }}
        >
          {aspect.asserted
            ? 'This is your assumption — kept so the investigation can move forward. Not yet confirmed in data.'
            : aspect.conf === 'high'
              ? 'Multiple independent signals point the same way — where they sit, the 90-day direction, and the look-alike comparison.'
              : 'Based on a single signal or an estimate — treat as a directional hint, not a certainty.'}
        </div>

        {/* Playground deep-link */}
        <div style={{ marginBottom: 20 }}>
          {playgroundLink ? (
            <button
              onClick={openInPlayground}
              style={{
                fontFamily: 'var(--font-sans)',
                border: 'none',
                background: 'none',
                color: 'var(--info-ink)',
                fontWeight: 600,
                fontSize: 12.5,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ↗ See the numbers in Playground
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Playground link unavailable — live Cube connection required.
            </span>
          )}
        </div>

        {/* Triage */}
        <div style={{ ...EYEBROW_STYLE, margin: '20px 0 8px' }}>What do you make of it?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['keep', 'flag', 'dismiss'] as const).map((t) => {
            const active = aspect.triage === t;
            const cfg = TRIAGE_CONFIG[t];
            return (
              <button
                key={t}
                onClick={() => onTriage(aspect.id, active ? null : t)}
                style={{
                  fontFamily: 'var(--font-sans)',
                  flex: 1,
                  padding: '9px 0',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: `1px solid ${active ? cfg.ink : 'var(--border-strong)'}`,
                  background: active ? cfg.bg : 'var(--bg-card)',
                  color: active ? cfg.ink : 'var(--text-secondary)',
                }}
              >
                {cfg.icon} {cfg.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
