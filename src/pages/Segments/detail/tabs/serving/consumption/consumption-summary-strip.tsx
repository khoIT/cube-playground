/** Six headline tiles for a served segment's consumption over the window. */

import { ReactElement } from 'react';
import type { ConsumptionSummary } from '../../../../../../types/segment-api';
import { formatLatency, formatDuration, formatPct } from './consumption-format';

const tile: React.CSSProperties = {
  flex: '1 1 130px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg, 10px)',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};
const value: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--text-primary)',
  fontVariantNumeric: 'tabular-nums',
};

export function ConsumptionSummaryStrip({ summary }: { summary: ConsumptionSummary }): ReactElement {
  const tiles: Array<{ k: string; v: string; hint?: string }> = [
    { k: 'Pulls', v: summary.pulls.toLocaleString() },
    { k: 'Consuming keys', v: String(summary.consumingKeys), hint: 'actually pulled' },
    { k: 'Rows · last pull', v: summary.rowsLastPull.toLocaleString() },
    { k: 'Success', v: formatPct(summary.successRate) },
    { k: 'p95 latency', v: formatLatency(summary.p95LatencyMs) },
    { k: 'Freshness @ pull', v: formatDuration(summary.avgFreshnessMs), hint: 'avg snapshot age when pulled' },
  ];
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      {tiles.map((tl) => (
        <div key={tl.k} style={tile}>
          <span style={label}>{tl.k}</span>
          <span style={value}>{tl.v}</span>
          {tl.hint && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tl.hint}</span>}
        </div>
      ))}
    </div>
  );
}
