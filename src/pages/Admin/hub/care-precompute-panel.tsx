/**
 * CarePrecomputePanel — "Care Precompute" board in the sys-admin hub.
 *
 * Sibling to Pre-agg Runs / Segment Refreshes: watches the nightly Care-tab
 * precompute (the heavy cross-catalog CS-ticket join that warms each segment's
 * Care payload). Shows per-segment cache freshness + status, recent passes, and
 * a "Run now" manual trigger. Tokens only; mirrors preagg/refresh board recipes.
 */

import React, { useMemo, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { fmtAge } from './segment-refresh-ops-data';
import {
  useCarePrecompute,
  triggerCarePrecompute,
  fmtWindow,
  type CareRun,
  type CareCacheStatus,
} from './care-precompute-data';

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
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-card)',
};

const td: React.CSSProperties = {
  padding: '9px 12px',
  fontSize: 12.5,
  color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-card)',
  verticalAlign: 'middle',
};

function StatusPill({ status }: { status: 'ok' | 'error' | 'never' }) {
  const map = {
    ok: { bg: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'ok' },
    error: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'error' },
    never: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)', label: 'never run' },
  }[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 11,
        fontWeight: 600,
        background: map.bg,
        color: map.ink,
      }}
    >
      {map.label}
    </span>
  );
}

interface SegmentRowData {
  cache: CareCacheStatus;
  latestRun: CareRun | null;
}

export function CarePrecomputePanel() {
  // Poll every 30s so freshness + a triggered run's outcome stay live.
  const { data, loading, error, refetch } = useCarePrecompute(30_000);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const runNow = async (segmentId: string) => {
    setBusy(segmentId, true);
    setNotice(null);
    const err = await triggerCarePrecompute(segmentId);
    if (err) setNotice(err);
    // Give the serial chain a beat, then refresh so the new run row appears.
    setTimeout(() => void refetch(), 1500);
    setBusy(segmentId, false);
  };

  // One row per cached segment, joined to its most-recent run.
  const rows = useMemo<SegmentRowData[]>(() => {
    if (!data) return [];
    const latestBySeg = new Map<string, CareRun>();
    for (const r of data.runs) {
      if (!latestBySeg.has(r.segmentId)) latestBySeg.set(r.segmentId, r); // runs are newest-first
    }
    return [...data.cache]
      .sort((a, b) => {
        // Errors first, then oldest freshness first (most in need of a run).
        if (a.status !== b.status) return a.status === 'error' ? -1 : 1;
        return (a.computedAt ?? '').localeCompare(b.computedAt ?? '');
      })
      .map((cache) => ({ cache, latestRun: latestBySeg.get(cache.segmentId) ?? null }));
  }, [data]);

  if (error) {
    return (
      <div
        role="tabpanel"
        id="hub-tab-panel-care-precompute"
        aria-labelledby="hub-tab-care-precompute"
        style={{ ...card, marginTop: 16, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '14px 16px', fontSize: 13 }}
      >
        Could not load care precompute status: {error}
      </div>
    );
  }

  return (
    <div
      role="tabpanel"
      id="hub-tab-panel-care-precompute"
      aria-labelledby="hub-tab-care-precompute"
      style={{ maxWidth: 1120, fontFamily: 'var(--font-sans)' }}
    >
      <header style={{ marginBottom: 18, marginTop: 16 }}>
        <div style={eyebrow}>Segments · Care precompute</div>
        <h2 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 9 }}>
          <HeartPulse size={22} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          Care Precompute
        </h2>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 640, lineHeight: 1.45 }}>
          Nightly warming of the segment Care tab — the heavy cross-catalog CS-ticket join. A warm
          cache makes the tab open instantly and survive a Trino hiccup (serve-stale). Run a pass
          manually below if a segment is stale or erroring.
        </p>
        {data && (
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Window <strong style={{ color: 'var(--text-primary)' }}>{fmtWindow(data.window)}</strong> GMT+7 · serial drain (one segment at a time)
          </p>
        )}
      </header>

      {notice && (
        <div style={{ ...card, background: 'var(--warning-soft)', color: 'var(--warning-ink)', padding: '10px 14px', marginBottom: 14, fontSize: 12.5 }}>
          {notice}
        </div>
      )}

      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Cached segments</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {data ? `${data.cache.length} segment${data.cache.length === 1 ? '' : 's'} · errors first` : 'CS-covered predicate segments'}
          </span>
        </div>

        {loading && !data ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            No Care payloads cached yet — they warm on the first load or the nightly pass.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Segment</th>
                <th style={th}>Game</th>
                <th style={th}>Status</th>
                <th style={th}>Computed</th>
                <th style={th}>Last run</th>
                <th style={{ ...th, textAlign: 'right' }}>Tickets</th>
                <th style={{ ...th, textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cache, latestRun }) => {
                const status: 'ok' | 'error' | 'never' = !cache.hasPayload
                  ? cache.status === 'error'
                    ? 'error'
                    : 'never'
                  : cache.status;
                const computedAgeMs = cache.computedAt ? Date.now() - Date.parse(cache.computedAt) : null;
                const runAgeMs = latestRun?.startedAt ? Date.now() - Date.parse(latestRun.startedAt) : null;
                return (
                  <tr key={cache.segmentId}>
                    <td style={{ ...td, fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5 }}>{cache.segmentId}</td>
                    <td style={td}>{cache.gameId}</td>
                    <td style={td}>
                      <StatusPill status={status} />
                      {cache.lastError && (
                        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--destructive-ink)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cache.lastError}>
                          {cache.lastError}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>{cache.computedAt ? `${fmtAge(computedAgeMs)} ago` : '—'}</td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>
                      {latestRun ? (
                        <>
                          {fmtAge(runAgeMs)} ago · {latestRun.source}
                          {latestRun.elapsedMs != null && ` · ${(latestRun.elapsedMs / 1000).toFixed(1)}s`}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{latestRun?.tickets ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        type="button"
                        disabled={busyIds.has(cache.segmentId)}
                        onClick={() => void runNow(cache.segmentId)}
                        style={{
                          padding: '4px 10px',
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-card)',
                          background: 'var(--bg-subtle, transparent)',
                          color: 'var(--text-primary)',
                          cursor: busyIds.has(cache.segmentId) ? 'default' : 'pointer',
                          opacity: busyIds.has(cache.segmentId) ? 0.6 : 1,
                        }}
                      >
                        {busyIds.has(cache.segmentId) ? 'Running…' : 'Run now'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
