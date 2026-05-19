/** Cohort count + sparkline trend of last estimates. */

import { ReactElement } from 'react';
import { Sparkline } from '../../visuals';

interface Props {
  count: number | null;
  loading: boolean;
  error: string | null;
  ringBuffer: number[];
}

function formatCount(n: number | null): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function ResolvedCohortCard({ count, loading, error, ringBuffer }: Props): ReactElement {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Resolved cohort</span>
      <span style={{ fontSize: 28, fontWeight: 600, color: 'var(--text-primary)' }}>
        {loading ? '…' : formatCount(count)}
      </span>
      {error && <span style={{ fontSize: 11, color: 'var(--text-danger, #c0392b)' }}>{error}</span>}
      {ringBuffer.length > 1 && <Sparkline data={ringBuffer} />}
    </div>
  );
}
