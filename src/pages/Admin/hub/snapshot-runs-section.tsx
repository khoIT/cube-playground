/**
 * SnapshotRunsSection — "Lakehouse snapshots" card inside the Segment Refreshes
 * admin tab. Watches the nightly membership-snapshot job (path: cohort →
 * stag_iceberg.khoitn.segment_membership_daily).
 *
 * Two truth sources rendered side by side, deliberately:
 *  - "Latest landed" comes from shared Trino — cross-instance truth (the job
 *    may run on another gateway; SQLite heartbeats don't replicate).
 *  - The runs table is THIS gateway's heartbeat log (empty here ≠ not running).
 */

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

interface SnapshotRunError {
  segmentId: string;
  gameId: string | null;
  detail: string | null;
}

interface SnapshotRun {
  snapshotDate: string;
  startedAt: string | null;
  written: number;
  skipped: number;
  errored: number;
  deltaStatus: string | null;
  deltaRows: number | null;
  definitionsStatus: string | null;
  definitionsRows: number | null;
  errors: SnapshotRunError[];
}

interface SnapshotRunsPayload {
  enabledHere: boolean;
  runs: SnapshotRun[];
  latestLanded: { snapshotDate: string; games: Array<{ gameId: string; segments: number; rows: number }> } | null;
  latestLandedError: string | null;
}

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
};

const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

const th: React.CSSProperties = {
  ...eyebrow,
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-card)',
};

const td: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12.5,
  color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-card)',
  verticalAlign: 'top',
};

/** Yesterday in GMT+7 — the snapshot a healthy nightly run should have landed. */
function expectedSnapshotDate(): string {
  return new Date(Date.now() + 7 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
}

function Chip({ tone, children }: { tone: 'success' | 'warning' | 'muted'; children: React.ReactNode }) {
  const map = {
    success: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
    warning: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
    muted: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
  } as const;
  return (
    <span style={{ background: map[tone].bg, color: map[tone].ink, borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 11.5, fontWeight: 600 }}>
      {children}
    </span>
  );
}

export function SnapshotRunsSection() {
  const [data, setData] = useState<SnapshotRunsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<SnapshotRunsPayload>('/api/segment-refresh/snapshot-runs')
      .then((d) => { if (alive) setData(d); })
      .catch((err: Error) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <section style={{ ...card, marginTop: 14, padding: '12px 16px', fontSize: 12.5, color: 'var(--destructive-ink)' }}>
        Could not load snapshot runs: {error}
      </section>
    );
  }
  if (!data) return null;

  const latest = data.latestLanded;
  const fresh = latest != null && latest.snapshotDate >= expectedSnapshotDate();

  return (
    <section style={{ ...card, marginTop: 14, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Lakehouse snapshots</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          nightly membership → stag_iceberg.khoitn
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {latest ? (
            <Chip tone={fresh ? 'success' : 'warning'}>
              latest landed {latest.snapshotDate}{fresh ? '' : ' — stale'}
            </Chip>
          ) : (
            <Chip tone="warning">
              {data.latestLandedError ? 'lakehouse unreachable' : 'no partitions landed yet'}
            </Chip>
          )}
          <Chip tone={data.enabledHere ? 'success' : 'muted'}>
            job {data.enabledHere ? 'enabled' : 'off'} on this gateway
          </Chip>
        </span>
      </div>

      {latest && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-card)', display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
          {latest.games.map((g) => (
            <span key={g.gameId}>
              <strong style={{ color: 'var(--text-primary)' }}>{g.gameId}</strong>
              {' '}{g.segments} seg · {g.rows.toLocaleString()} rows
            </span>
          ))}
        </div>
      )}

      {data.runs.length === 0 ? (
        <div style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          No snapshot runs recorded on this gateway. The heartbeat log is per-instance —
          the job may be running elsewhere; "latest landed" above is the shared-lakehouse truth.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Snapshot date</th>
              <th style={th}>Started</th>
              <th style={th}>Written</th>
              <th style={th}>Skipped</th>
              <th style={th}>Errored</th>
              <th style={th}>Delta</th>
              <th style={th}>Definitions</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((run) => (
              <React.Fragment key={run.snapshotDate}>
                <tr>
                  <td style={{ ...td, fontWeight: 600 }}>{run.snapshotDate}</td>
                  <td style={td}>{run.startedAt ?? '—'}</td>
                  <td style={td}>{run.written}</td>
                  <td style={td}>{run.skipped}</td>
                  <td style={{ ...td, color: run.errored > 0 ? 'var(--destructive-ink)' : 'var(--text-primary)', fontWeight: run.errored > 0 ? 700 : 400 }}>
                    {run.errored}
                  </td>
                  <td style={td}>
                    {run.deltaStatus
                      ? `${run.deltaStatus}${run.deltaRows != null ? ` · ${run.deltaRows.toLocaleString()} rows` : ''}`
                      : '—'}
                  </td>
                  <td style={{ ...td, color: run.definitionsStatus === 'error' ? 'var(--destructive-ink)' : 'var(--text-primary)' }}>
                    {run.definitionsStatus
                      ? `${run.definitionsStatus}${run.definitionsRows != null ? ` · ${run.definitionsRows.toLocaleString()} rows` : ''}`
                      : '—'}
                  </td>
                </tr>
                {run.errors.map((e) => (
                  <tr key={`${run.snapshotDate}-${e.segmentId}`}>
                    <td colSpan={7} style={{ ...td, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', fontSize: 12 }}>
                      {e.segmentId}{e.gameId ? ` (${e.gameId})` : ''}: {e.detail ?? 'unknown error'}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
