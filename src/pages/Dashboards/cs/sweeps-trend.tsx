/**
 * Per-playbook cohort-size trend — a compact sparkline grid showing how each
 * playbook's matched cohort moved across sweep runs (oldest→newest). Minimal
 * token-styled SVG (no chart lib). Reads from /api/care/sweeps/trend.
 */

import { useSweepTrend, type PlaybookTrend } from './use-care-sweeps';

function Sparkline({ trend }: { trend: PlaybookTrend }) {
  const W = 120;
  const H = 28;
  const vals = trend.points.map((p) => p.cohortSize);
  const max = Math.max(1, ...vals);
  const n = vals.length;
  const last = vals[n - 1] ?? 0;
  const prev = vals[n - 2] ?? last;
  const delta = last - prev;

  const points = vals
    .map((v, i) => {
      const x = n <= 1 ? W : (i / (n - 1)) * W;
      const y = H - (v / max) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const deltaColor = delta > 0 ? 'var(--success-ink)' : delta < 0 ? 'var(--destructive-ink)' : 'var(--text-muted)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 14px',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-card)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
          Playbook {trend.playbookId}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {last.toLocaleString()} now{' '}
          <span style={{ color: deltaColor }}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '·'} {Math.abs(delta).toLocaleString()}
          </span>
        </div>
      </div>
      <svg width={W} height={H} style={{ flexShrink: 0 }} aria-hidden>
        {n > 1 ? (
          <polyline points={points} fill="none" stroke="var(--brand)" strokeWidth={1.5} strokeLinejoin="round" />
        ) : (
          <circle cx={W} cy={H - (last / max) * (H - 4) - 2} r={2} fill="var(--brand)" />
        )}
      </svg>
    </div>
  );
}

export function SweepsTrend({ gameId }: { gameId: string }) {
  const { status, trends, error } = useSweepTrend(gameId);

  if (status === 'error') {
    return (
      <div style={{ padding: 12, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
        Failed to load trend: {error}
      </div>
    );
  }
  // Only playbooks with movement worth showing (≥1 run that matched anyone).
  const active = trends.filter((t) => t.points.some((p) => p.cohortSize > 0));
  if (status === 'success' && active.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)' }}>
        No cohort history yet — run a sweep to start the trend.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
      {active.map((t) => (
        <Sparkline key={t.playbookId} trend={t} />
      ))}
    </div>
  );
}
