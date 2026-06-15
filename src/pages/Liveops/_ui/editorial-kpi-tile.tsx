/**
 * KPI tile for the LiveOps hero strip.
 *
 * Sans-serif Inter via var(--font-sans); semantic color + spacing tokens
 * shared with the rest of the app. Delta colours map to --positive /
 * --negative / --text-muted so the strip stays consistent with cohort/
 * dashboard surfaces.
 */

import { type ReactNode } from 'react';
import { Sparkline } from '../../Segments/visuals/sparkline';

interface Props {
  label: string;
  value: ReactNode;
  delta?: string | null;
  tone?: 'positive' | 'negative' | 'neutral';
  sparkline?: number[];
}

const wrapStyle: React.CSSProperties = {
  padding: '14px 14px 12px',
  fontFamily: 'var(--font-sans)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-muted)',
  marginBottom: 6,
  letterSpacing: '0.005em',
};

const valueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  letterSpacing: '-0.015em',
  lineHeight: 1.15,
  color: 'var(--text-primary)',
  fontVariantNumeric: 'tabular-nums',
};

const deltaBase: React.CSSProperties = {
  fontSize: 12,
  marginTop: 4,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
};

function deltaColor(tone: Props['tone']): string {
  if (tone === 'positive') return 'var(--positive)';
  if (tone === 'negative') return 'var(--negative)';
  return 'var(--text-muted)';
}

export function EditorialKpiTile({ label, value, delta, tone, sparkline }: Props) {
  return (
    <div style={wrapStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={valueStyle}>{value}</div>
      {delta && (
        <div style={{ ...deltaBase, color: deltaColor(tone) }}>{delta}</div>
      )}
      {sparkline && sparkline.length > 0 && (
        <div style={{ marginTop: 10, marginLeft: -2 }}>
          <Sparkline data={sparkline} height={26} />
        </div>
      )}
    </div>
  );
}
