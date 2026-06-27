/**
 * Authenticated-outcome breakdown for the window: OK (200) / no snapshot (409) /
 * rate-limited (429), each a proportional bar. 401 failed-auth is intentionally
 * absent — it lives in server logs, not the audit table.
 */

import { ReactElement } from 'react';
import type { ConsumptionStatusBreakdown } from '../../../../../../types/segment-api';

interface BarRow {
  label: string;
  count: number;
  color: string;
}

export function ConsumptionHealthPanel({ breakdown }: { breakdown: ConsumptionStatusBreakdown }): ReactElement {
  const rows: BarRow[] = [
    { label: 'OK (200)', count: breakdown.ok, color: 'var(--success-ink)' },
    { label: 'No snapshot (409)', count: breakdown.no_snapshot, color: 'var(--warning-ink)' },
    { label: 'Rate limited (429)', count: breakdown.rate_limited, color: 'var(--destructive-ink)' },
  ];
  const total = rows.reduce((a, r) => a + r.count, 0);

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg, 10px)', padding: '14px 16px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Pull outcomes</div>
      {total === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>No pulls in this window.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-secondary, var(--text-muted))' }}>
                <span>{r.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.count}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-muted)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${total > 0 ? (r.count / total) * 100 : 0}%`, background: r.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
