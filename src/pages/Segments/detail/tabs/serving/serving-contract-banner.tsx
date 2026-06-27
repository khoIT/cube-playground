/**
 * Violet contract banner that leads the activation tab for a served segment:
 * lifecycle + entitled keys + cadence + last pull-ready, plus an edit guard
 * warning. The accent is the segment-member violet so "this is a live contract"
 * reads instantly against the warm-cream surfaces.
 */

import { ReactElement } from 'react';
import { Radio, AlertTriangle } from 'lucide-react';
import type { ServingContract } from '../../../../../types/segment-api';
import { relative } from './serving-format';

const ACCENT = 'var(--layer-segment, #725390)';

const stat: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const statLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
};
const statValue: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--text-primary)',
  fontVariantNumeric: 'tabular-nums',
};

export function ServingContractBanner({
  serving,
  deprecated,
}: {
  serving: ServingContract;
  deprecated?: boolean;
}): ReactElement {
  return (
    <div
      style={{
        border: `1px solid color-mix(in srgb, ${ACCENT} 35%, transparent)`,
        background: `color-mix(in srgb, ${ACCENT} 7%, var(--bg-card))`,
        borderRadius: 'var(--radius-xl, 14px)',
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Radio size={16} aria-hidden style={{ color: ACCENT }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, letterSpacing: '0.02em' }}>
          {deprecated ? 'Retired serving contract' : 'Serving contract'}
        </span>
        {serving.servedAt && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· published {relative(serving.servedAt)}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <div style={stat}>
          <span style={statLabel}>Entitled keys</span>
          <span style={statValue}>{serving.entitledCount}</span>
        </div>
        <div style={stat}>
          <span style={statLabel}>Cadence</span>
          <span style={statValue}>{serving.cadence === 'Off' ? 'On demand' : serving.cadence}</span>
        </div>
        <div style={stat}>
          <span style={statLabel}>Last snapshot</span>
          <span style={statValue}>{relative(serving.lastSnapshotAt)}</span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          marginTop: 14,
          padding: '8px 10px',
          borderRadius: 'var(--radius-md, 8px)',
          background: 'var(--warning-soft)',
          color: 'var(--warning-ink)',
          fontSize: 12.5,
          lineHeight: 1.45,
        }}
      >
        <AlertTriangle size={14} aria-hidden style={{ marginTop: 1, flex: 'none' }} />
        <span>
          {deprecated
            ? 'Demoted — downstream pulls are blocked (403). Re-publish to serve it again.'
            : 'Downstream apps depend on this. Edits apply on the next snapshot; renaming or deleting it breaks their integration. Demote first if you need to retire it.'}
        </span>
      </div>
    </div>
  );
}
