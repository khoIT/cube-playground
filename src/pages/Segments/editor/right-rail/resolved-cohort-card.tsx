/** Cohort count + delta vs saved + dual sparkline of live estimates. */

import { ReactElement } from 'react';
import { DualSparkline } from './dual-sparkline';

interface Props {
  count: number | null;
  loading: boolean;
  error: string | null;
  ringBuffer: number[];
  /** Currently saved segment size, for delta + saved-trend overlay. */
  savedCount?: number | null;
  /** Historical uid_count series for the currently saved segment (oldest → newest). */
  savedTrend?: number[];
}

function formatCount(n: number | null): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function deltaLine(current: number | null, saved: number | null | undefined): {
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
} | null {
  if (current == null || saved == null || saved === 0) return null;
  const diffPct = ((current - saved) / saved) * 100;
  const arrow = diffPct >= 0 ? '↑' : '↓';
  const tone: 'positive' | 'negative' | 'neutral' =
    Math.abs(diffPct) < 0.05 ? 'neutral' : diffPct > 0 ? 'positive' : 'negative';
  return {
    text: `${arrow} ${Math.abs(diffPct).toFixed(1)}% vs ${formatCount(saved)} saved`,
    tone,
  };
}

const TONE_COLOR: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'var(--success)',
  negative: 'var(--danger, #c0392b)',
  neutral: 'var(--text-muted)',
};

export function ResolvedCohortCard({
  count,
  loading,
  error,
  ringBuffer,
  savedCount,
  savedTrend,
}: Props): ReactElement {
  const delta = deltaLine(count, savedCount);
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Resolved cohort</span>
      <span style={{ fontSize: 28, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.1 }}>
        {loading ? '…' : formatCount(count)}
      </span>
      {delta && (
        <span style={{ fontSize: 11.5, fontWeight: 500, color: TONE_COLOR[delta.tone] }}>
          {delta.text}
        </span>
      )}
      {error && <span style={{ fontSize: 11, color: 'var(--text-danger, #c0392b)' }}>{error}</span>}
      {(ringBuffer.length > 1 || (savedTrend && savedTrend.length > 1)) && (
        <div style={{ marginTop: 6 }}>
          <DualSparkline saved={savedTrend ?? []} projected={ringBuffer} />
          <div
            style={{
              display: 'flex',
              gap: 10,
              fontSize: 10.5,
              color: 'var(--text-muted)',
              marginTop: 4,
            }}
          >
            <LegendSwatch color="var(--text-muted)" dashed>Saved trend</LegendSwatch>
            <LegendSwatch color="var(--brand)">Projected</LegendSwatch>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendSwatch({
  color,
  dashed,
  children,
}: {
  color: string;
  dashed?: boolean;
  children: ReactElement | string;
}): ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          width: 12,
          height: 0,
          borderTop: `1.5px ${dashed ? 'dashed' : 'solid'} ${color}`,
        }}
      />
      {children}
    </span>
  );
}
