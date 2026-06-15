/**
 * CarePrecomputePanel — "Care Precompute" board in the sys-admin hub.
 *
 * Sibling to Pre-agg Runs / Segment Refreshes: watches the nightly Care-tab
 * precompute (the heavy cross-catalog CS-ticket join that warms each segment's
 * Care payload). Shows per-segment cache freshness + status, and lets an
 * operator expand a segment to see its run history — each pass broken down by
 * Trino read (which query was slow / timed out / degraded). A per-segment
 * "Run now" + a header "Run all" (full re-warm) trigger passes manually.
 * Tokens only; mirrors preagg/refresh board recipes.
 */

import React, { useMemo, useState } from 'react';
import { HeartPulse, ChevronRight, ChevronDown } from 'lucide-react';
import { fmtAge } from './segment-refresh-ops-data';
import {
  useCarePrecompute,
  triggerCarePrecompute,
  triggerCareRewarmAll,
  fmtWindow,
  type CareRun,
  type CareCacheStatus,
  type CareStage,
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

const btn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-card)',
  background: 'var(--bg-subtle, transparent)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
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

/** Map each stage status to a semantic token pair. */
function stageColors(status: CareStage['status']): { bg: string; ink: string } {
  switch (status) {
    case 'ok':
      return { bg: 'var(--success-soft)', ink: 'var(--success-ink)' };
    case 'timeout':
    case 'error':
      return { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)' };
    case 'degraded':
      return { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' };
    default:
      return { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' };
  }
}

/** One pass's per-Trino-read breakdown. */
function StageList({ stages }: { stages: CareStage[] }) {
  if (stages.length === 0) {
    return <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>No per-query detail recorded.</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {stages.map((s, i) => {
        const c = stageColors(s.status);
        return (
          <div key={`${s.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', minWidth: 168, color: 'var(--text-primary)' }}>
              {s.name}
            </span>
            <span
              style={{
                display: 'inline-block',
                padding: '1px 7px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                background: c.bg,
                color: c.ink,
              }}
            >
              {s.status}
            </span>
            <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>
              {s.status === 'skipped' ? '—' : `${(s.elapsedMs / 1000).toFixed(1)}s`}
            </span>
            {s.rows != null && <span style={{ color: 'var(--text-muted)' }}>{s.rows.toLocaleString()} rows</span>}
            {s.error && (
              <span
                style={{ color: 'var(--destructive-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}
                title={s.error}
              >
                {s.error}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Run-history timeline for one expanded segment. */
function RunHistory({ runs }: { runs: CareRun[] }) {
  if (runs.length === 0) {
    return (
      <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
        No runs recorded yet for this segment.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
      {runs.map((r) => {
        const ageMs = Date.now() - Date.parse(r.startedAt);
        return (
          <div key={r.id} style={{ ...card, padding: '10px 12px', background: 'var(--bg-subtle, transparent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 12 }}>
              <StatusPill status={r.status} />
              <span style={{ color: 'var(--text-muted)' }}>{fmtAge(ageMs)} ago</span>
              <span style={{ color: 'var(--text-muted)' }}>· {r.source}</span>
              {r.elapsedMs != null && <span style={{ color: 'var(--text-muted)' }}>· {(r.elapsedMs / 1000).toFixed(1)}s total</span>}
              {r.tickets != null && <span style={{ color: 'var(--text-muted)' }}>· {r.tickets.toLocaleString()} tickets</span>}
            </div>
            <StageList stages={r.stages} />
          </div>
        );
      })}
    </div>
  );
}

interface SegmentRowData {
  cache: CareCacheStatus;
  latestRun: CareRun | null;
  history: CareRun[];
}

export function CarePrecomputePanel() {
  // Poll every 30s so freshness + a triggered run's outcome stay live.
  const { data, loading, error, refetch } = useCarePrecompute(30_000);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allBusy, setAllBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  const runAll = async () => {
    setAllBusy(true);
    setNotice(null);
    const err = await triggerCareRewarmAll();
    setNotice(err ?? 'Full re-warm queued — every CS-covered segment will rebuild serially.');
    setTimeout(() => void refetch(), 1500);
    setAllBusy(false);
  };

  // One row per cached segment, joined to its run history (newest-first).
  const rows = useMemo<SegmentRowData[]>(() => {
    if (!data) return [];
    const bySeg = new Map<string, CareRun[]>();
    for (const r of data.runs) {
      const list = bySeg.get(r.segmentId);
      if (list) list.push(r);
      else bySeg.set(r.segmentId, [r]); // data.runs is newest-first
    }
    return [...data.cache]
      .sort((a, b) => {
        // Errors first, then oldest freshness first (most in need of a run).
        if (a.status !== b.status) return a.status === 'error' ? -1 : 1;
        return (a.computedAt ?? '').localeCompare(b.computedAt ?? '');
      })
      .map((cache) => {
        const history = bySeg.get(cache.segmentId) ?? [];
        return { cache, latestRun: history[0] ?? null, history };
      });
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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={eyebrow}>Segments · Care precompute</div>
            <h2 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 9 }}>
              <HeartPulse size={22} style={{ color: 'var(--brand)', flexShrink: 0 }} />
              Care Precompute
            </h2>
          </div>
          <button
            type="button"
            disabled={allBusy}
            onClick={() => void runAll()}
            style={{ ...btn, padding: '7px 14px', cursor: allBusy ? 'default' : 'pointer', opacity: allBusy ? 0.6 : 1, flexShrink: 0 }}
            title="Re-warm every CS-covered segment regardless of freshness"
          >
            {allBusy ? 'Queuing…' : 'Run all'}
          </button>
        </div>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 640, lineHeight: 1.45 }}>
          Nightly warming of the segment Care tab — the heavy cross-catalog CS-ticket join. A warm
          cache makes the tab open instantly and survive a Trino hiccup (serve-stale). Run a pass
          manually below, or "Run all" to re-warm every covered segment. Expand a row to see each
          pass broken down by Trino read.
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
                <th style={{ ...th, width: 28 }} />
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
              {rows.map(({ cache, latestRun, history }) => {
                const status: 'ok' | 'error' | 'never' = !cache.hasPayload
                  ? cache.status === 'error'
                    ? 'error'
                    : 'never'
                  : cache.status;
                const computedAgeMs = cache.computedAt ? Date.now() - Date.parse(cache.computedAt) : null;
                const runAgeMs = latestRun?.startedAt ? Date.now() - Date.parse(latestRun.startedAt) : null;
                const isOpen = expanded.has(cache.segmentId);
                return (
                  <React.Fragment key={cache.segmentId}>
                    <tr
                      onClick={() => toggle(cache.segmentId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ ...td, textAlign: 'center', color: 'var(--text-muted)' }}>
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </td>
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
                      <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={busyIds.has(cache.segmentId)}
                          onClick={() => void runNow(cache.segmentId)}
                          style={{ ...btn, cursor: busyIds.has(cache.segmentId) ? 'default' : 'pointer', opacity: busyIds.has(cache.segmentId) ? 0.6 : 1 }}
                        >
                          {busyIds.has(cache.segmentId) ? 'Running…' : 'Run now'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid var(--border-card)', background: 'var(--bg-elevated, transparent)' }}>
                          <RunHistory runs={history} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
