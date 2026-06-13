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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloudUpload } from 'lucide-react';
import { apiFetch } from '../../../api/api-client';
import { SnapshotRunExpandableRow, type SnapshotRun } from './snapshot-run-expandable-row';
import { SnapshotConfirmDialog } from './snapshot-confirm-dialog';

interface SnapshotRunsPayload {
  enabledHere: boolean;
  /** A snapshot run (cron or manual) is in flight on THIS gateway right now. */
  runningNow: boolean;
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

/** Yesterday in GMT+7 — the snapshot a healthy nightly run should have landed. */
function expectedSnapshotDate(): string {
  return new Date(Date.now() + 7 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
}

function Chip({ tone, title, children }: { tone: 'success' | 'warning' | 'muted'; title?: string; children: React.ReactNode }) {
  const map = {
    success: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
    warning: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
    muted: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
  } as const;
  return (
    <span title={title} style={{ background: map[tone].bg, color: map[tone].ink, borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 11.5, fontWeight: 600, cursor: title ? 'help' : 'default' }}>
      {children}
    </span>
  );
}

export function SnapshotRunsSection() {
  const [data, setData] = useState<SnapshotRunsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  // Open when "Snapshot now" would overwrite a partition that already landed
  // today (likely another gateway's cron) — an explicit operator decision.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // `fresh` bypasses the server's latest-partition TTL cache — used right after
  // a manual trigger and on run completion so the reachability chip + latest
  // partition reflect reality at once. Background/in-flight polls stay cached so
  // a healthy run doesn't re-probe cold Trino every 5s.
  const refetch = useCallback((fresh = false) => {
    return apiFetch<SnapshotRunsPayload>(`/api/segment-refresh/snapshot-runs${fresh ? '?fresh=1' : ''}`)
      .then((d) => {
        setData(d);
        setError(null); // a recovered poll must clear a prior blip, not stick on it
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  // A snapshot run takes minutes (full-cohort Trino INSERTs) — poll while one
  // is in flight on this gateway so the table fills in as segments land.
  const runningNow = data?.runningNow ?? false;
  useEffect(() => {
    if (!runningNow) return;
    const t = setInterval(() => void refetch(), 5000);
    return () => clearInterval(t);
  }, [runningNow, refetch]);

  // When a run finishes (runningNow true→false) do ONE fresh refetch so the
  // run-level outcome (incl. a lakehouse-unreachable failure) and the chip
  // update immediately rather than waiting for the cache TTL to lapse.
  const prevRunning = useRef(false);
  useEffect(() => {
    if (prevRunning.current && !runningNow) void refetch(true);
    prevRunning.current = runningNow;
  }, [runningNow, refetch]);

  const runSnapshot = useCallback(() => {
    setTriggering(true);
    apiFetch('/api/segment-refresh/snapshot-runs/trigger', { method: 'POST' })
      .catch(() => { /* 409 ALREADY_RUNNING etc. — refetch shows the truth */ })
      // Fresh: a fast-failing run (e.g. lakehouse unreachable) may already be
      // done before the first in-flight poll, so this is the chance to land the
      // run-level error + a current reachability probe.
      .then(() => refetch(true))
      .finally(() => setTriggering(false));
  }, [refetch]);

  // Today (GMT+7) — the partition a "Snapshot now" would write/overwrite.
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const wouldOverwriteToday = data?.latestLanded?.snapshotDate === today;

  const triggerSnapshot = useCallback(() => {
    // The lakehouse is SHARED and the server's in-flight guard is per-gateway:
    // if today's partition already landed (likely another gateway's cron), a
    // re-run rewrites it from THIS gateway's segments — and overlapping a run
    // still in flight elsewhere would silently duplicate membership rows.
    // Make that an explicit operator decision, not a stray click.
    if (wouldOverwriteToday) {
      setConfirmOpen(true);
      return;
    }
    runSnapshot();
  }, [wouldOverwriteToday, runSnapshot]);

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
          {'nightly membership → stag_iceberg."khoitn/{env}"'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {latest ? (
            <Chip tone={fresh ? 'success' : 'warning'}>
              latest landed {latest.snapshotDate}{fresh ? '' : ' — stale'}
            </Chip>
          ) : (
            <Chip tone="warning" title={data.latestLandedError ?? undefined}>
              {data.latestLandedError ? 'lakehouse unreachable' : 'no partitions landed yet'}
            </Chip>
          )}
          <Chip tone={data.enabledHere ? 'success' : 'muted'}>
            job {data.enabledHere ? 'enabled' : 'off'} on this gateway
          </Chip>
          {/* Manual run works even where the nightly cron is env-disabled —
              the writers are idempotent per (date, segment). */}
          <button
            type="button"
            onClick={triggerSnapshot}
            disabled={triggering || runningNow}
            title={
              runningNow
                ? 'A snapshot run is in flight on this gateway'
                : "Land today's membership snapshot from this gateway now"
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 26,
              padding: '0 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: triggering || runningNow ? 'default' : 'pointer',
              opacity: triggering || runningNow ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            <CloudUpload size={13} /> {runningNow ? 'Snapshotting…' : 'Snapshot now'}
          </button>
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
            {data.runs.map((run, idx) => (
              // Newest run (idx 0) is the in-flight one while a run is running
              // on this gateway — it carries today's __started__ sentinel.
              <SnapshotRunExpandableRow key={run.snapshotDate} run={run} live={runningNow && idx === 0} />
            ))}
          </tbody>
        </table>
      )}

      <SnapshotConfirmDialog
        open={confirmOpen}
        title="Re-snapshot today's partition?"
        body={
          <>
            Today's partition (<strong style={{ color: 'var(--text-primary)' }}>{today}</strong>) already
            landed in the lakehouse — likely from another gateway. Re-snapshotting now rewrites it from
            this gateway's segments, and would conflict with a run still in flight elsewhere.
          </>
        }
        confirmLabel="Snapshot anyway"
        onConfirm={() => {
          setConfirmOpen(false);
          runSnapshot();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
