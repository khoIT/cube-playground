/**
 * Editorial direction KPI tile — Phase 1 redesign.
 *
 * Serif numeric, sparse rule above, muted serif label, integrated sparkline
 * underneath. Designed to read like a column of newspaper figures rather
 * than a "card with chrome". Forks from <KpiTile> so changes don't regress
 * the Segments page.
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
  padding: '18px 16px 14px',
  borderTop: '1px solid var(--rule-editorial, var(--border-card))',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-editorial-serif, Georgia, "Iowan Old Style", serif)',
  fontSize: 13,
  color: 'var(--text-muted)',
  marginBottom: 6,
  letterSpacing: '0.005em',
};

const valueStyle: React.CSSProperties = {
  fontFamily: 'var(--font-editorial-serif, Georgia, "Iowan Old Style", serif)',
  fontSize: 28,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  lineHeight: 1.1,
  color: 'var(--text-primary)',
};

const deltaBase: React.CSSProperties = {
  fontSize: 12,
  marginTop: 4,
  fontFamily: 'var(--font-sans)',
  fontVariantNumeric: 'tabular-nums',
};

function deltaColor(tone: Props['tone']): string {
  if (tone === 'positive') return 'var(--positive, #15803d)';
  if (tone === 'negative') return 'var(--negative, #b91c1c)';
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
