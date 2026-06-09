/**
 * Sweeps lens — the sweep-snapshot comparison surface. Two parts per the design:
 *   1. Trend: per-playbook cohort size across all runs (SweepsTrend).
 *   2. Compare: pick two runs → per-playbook count deltas + entered/left VIP
 *      counts; click a row to drill into the entered/left VIPs (paginated).
 *
 * Reads only (viewer-ok). Resets when the game changes. Token-styled to match
 * the Case Ledger.
 */

import { useState, useEffect, useMemo, Fragment } from 'react';
import { SweepsTrend } from './sweeps-trend';
import { SweepsVipDrill } from './sweeps-vip-drill';
import { useSweepRuns, useSweepDiff, type SweepRun } from './use-care-sweeps';

function runLabel(r: SweepRun): string {
  const when = new Date(r.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const tag = r.status === 'ok' ? '' : ` · ${r.status}`;
  return `${when} · ${r.source}${tag}`;
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  maxWidth: 280,
};
const thStyle: React.CSSProperties = {
  padding: '8px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)',
  fontFamily: 'var(--font-sans)', borderBottom: '1px solid var(--border-card)',
};
const tdStyle: React.CSSProperties = { padding: '8px 14px', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' };

function deltaCell(n: number) {
  const color = n > 0 ? 'var(--success-ink)' : n < 0 ? 'var(--destructive-ink)' : 'var(--text-muted)';
  return <span style={{ color }}>{n > 0 ? `+${n}` : n}</span>;
}

export function SweepsLens({ gameId }: { gameId: string }) {
  const { status, runs } = useSweepRuns(gameId);
  const [runA, setRunA] = useState<string | null>(null);
  const [runB, setRunB] = useState<string | null>(null);
  const [openPb, setOpenPb] = useState<string | null>(null);

  // Default to the two most recent runs (A = previous, B = latest); reset on game switch.
  useEffect(() => {
    setOpenPb(null);
    if (runs.length >= 2) { setRunB(runs[0].runId); setRunA(runs[1].runId); }
    else { setRunB(runs[0]?.runId ?? null); setRunA(null); }
  }, [gameId, runs]);

  const { diff, status: diffStatus } = useSweepDiff(gameId, runA, runB);
  const changedFirst = useMemo(
    () => [...diff.playbooks].sort((a, b) => (b.enteredCount + b.leftCount) - (a.enteredCount + a.leftCount)),
    [diff.playbooks],
  );

  if (status === 'success' && runs.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)' }}>
        No sweep history yet. Run a sweep to start recording snapshots.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, fontFamily: 'var(--font-sans)' }}>
          Cohort trend per playbook
        </div>
        <SweepsTrend gameId={gameId} />
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>Compare</span>
          <select style={selectStyle} value={runA ?? ''} onChange={(e) => { setRunA(e.target.value || null); setOpenPb(null); }}>
            <option value="">— run A —</option>
            {runs.map((r) => <option key={r.runId} value={r.runId}>{runLabel(r)}</option>)}
          </select>
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <select style={selectStyle} value={runB ?? ''} onChange={(e) => { setRunB(e.target.value || null); setOpenPb(null); }}>
            <option value="">— run B —</option>
            {runs.map((r) => <option key={r.runId} value={r.runId}>{runLabel(r)}</option>)}
          </select>
        </div>

        {runA && runB && runA === runB && (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>Pick two different runs to compare.</div>
        )}
        {!diff.membershipAvailable && diffStatus === 'success' && (
          <div style={{ padding: 12, marginBottom: 12, background: 'var(--warning-soft)', color: 'var(--warning-ink)', borderRadius: 'var(--radius-md)', fontSize: 12.5, fontFamily: 'var(--font-sans)' }}>
            One of these runs had its membership snapshot pruned — counts are shown, but the per-VIP entered/left lists aren't available.
          </div>
        )}

        {runA && runB && runA !== runB && diff.playbooks.length > 0 && (
          <div style={{ border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Playbook</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Cohort A → B</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Δ</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Entered</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Left</th>
                </tr>
              </thead>
              <tbody>
                {changedFirst.map((p) => {
                  const open = openPb === p.playbookId;
                  const drillable = diff.membershipAvailable && (p.enteredCount > 0 || p.leftCount > 0);
                  return (
                    <Fragment key={p.playbookId}>
                      <tr
                        onClick={() => drillable && setOpenPb(open ? null : p.playbookId)}
                        style={{ borderTop: '1px solid var(--border-card)', cursor: drillable ? 'pointer' : 'default', background: open ? 'var(--bg-muted)' : undefined }}
                      >
                        <td style={tdStyle}>Playbook {p.playbookId}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{p.cohortA} → {p.cohortB}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{deltaCell(p.cohortDelta)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--success-ink)' }}>{p.enteredCount}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--destructive-ink)' }}>{p.leftCount}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={5} style={{ padding: 12, background: 'var(--bg-muted)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {p.enteredCount > 0 && (
                                <SweepsVipDrill gameId={gameId} runA={runA} runB={runB} playbookId={p.playbookId} direction="entered" />
                              )}
                              {p.leftCount > 0 && (
                                <SweepsVipDrill gameId={gameId} runA={runA} runB={runB} playbookId={p.playbookId} direction="left" />
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
