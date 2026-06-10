/**
 * PreaggRunsTab — "Pre-agg Runs" panel in the sys-admin hub.
 *
 * Layout, top to bottom:
 *   1. Page header (eyebrow + icon + title + cadence)
 *   2. Serveability-now strip (live/stale/fail/unbuilt pills)
 *   3. Amber stale headline banner (only when staleCount > 0 in latest sweep)
 *   4. KPI row (last sweep, sealed, stale-serving flagged, failed)
 *   5. Sweep history list with inline-expand → per-cube detail
 *
 * Tokens only — no inline hex. Mirrors observability-tab.tsx card/eyebrow
 * style recipes. Split-off sub-components live in preagg-runs-sweep-row.tsx.
 *
 * NOTE: failures attributed at rollup level (no game ctx in logs). The UI
 * surfaces a small disclaimer note in the strip for transparency.
 */

import React, { useState } from 'react';
import { Database } from 'lucide-react';
import { usePreaggRuns, useSweepDetail, useServeabilityNow } from './preagg-runs-data';
import { SweepRow } from './preagg-runs-sweep-row';
import type { PreaggSweepItem } from '../../../types/preagg-run';

// ---------------------------------------------------------------------------
// Shared style recipes (mirrors observability-tab.tsx)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Serveability-now strip
// ---------------------------------------------------------------------------

function ServeabilityStrip() {
  const { data, loading, error } = useServeabilityNow();

  if (error) {
    return (
      <div style={{ ...card, padding: '12px 16px', marginBottom: 12, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', fontSize: 12 }}>
        Could not load serveability: {error}
      </div>
    );
  }

  if (data?.warming) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px', marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <span style={{ width: 7, height: 7, borderRadius: 'var(--radius-full)', background: 'var(--brand)', animation: 'pulse 1.8s ease-in-out infinite', flexShrink: 0 }} />
        Warming serveability probe… this auto-refreshes in a few seconds.
      </div>
    );
  }

  const s = data?.summary;
  const built = s?.built ?? 0;
  const unbuilt = s?.unbuilt ?? 0;
  const errored = s?.errored ?? 0;
  const total = s?.totalRollups ?? 0;
  const games = s?.gamesCount ?? 0;
  // Serveability "stale" count comes from the most recent sweep (staleCount on
  // the sweep row) rather than the probe, which doesn't distinguish stale vs failed.
  // For the now-strip, we show probe-level counts (built vs unbuilt/errored).

  return (
    <div
      style={{
        ...card,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '13px 16px',
        marginBottom: 12,
        flexWrap: 'wrap',
      }}
    >
      {/* Serveable count */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          paddingRight: 14,
          borderRight: '1px solid var(--border-card)',
        }}
      >
        <span style={eyebrow}>Serveable now</span>
        <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
          {loading ? '…' : built}
          <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>
            /{loading ? '…' : total}
          </span>
        </span>
      </div>

      {/* Pills */}
      <Pill variant="live" label={`${built} serving warm`} />
      <Pill variant="fail" label={`${errored} not serveable`} />
      <Pill variant="unb"  label={`${unbuilt} never built`} />

      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
        across {games} games · {total} rollups
        {' · '}
        <span style={{ fontStyle: 'italic' }}>failures attributed at rollup level; serveability is per-game</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pill component
// ---------------------------------------------------------------------------

type PillVariant = 'live' | 'stale' | 'fail' | 'unb';

const PILL_STYLES: Record<PillVariant, React.CSSProperties> = {
  live:  { background: 'var(--live-badge-bg)',    borderColor: 'var(--live-badge-border)',    color: 'var(--live-badge-text)' },
  stale: { background: 'var(--stale-badge-bg)',   borderColor: 'var(--stale-badge-border)',   color: 'var(--stale-badge-text)' },
  fail:  { background: 'var(--destructive-soft)', borderColor: 'var(--destructive-ink)',     color: 'var(--destructive-ink)' },
  unb:   { background: 'var(--muted-soft)',        borderColor: 'var(--border-card)',          color: 'var(--muted-ink)' },
};

const PILL_DOT: Record<PillVariant, React.CSSProperties> = {
  live:  { background: 'var(--live-badge-dot)' },
  stale: { background: 'var(--stale-badge-dot)' },
  fail:  { background: 'var(--danger)' },
  unb:   { background: 'var(--neutral-400)' },
};

function Pill({ variant, label, pulse }: { variant: PillVariant; label: string; pulse?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 24,
        padding: '0 10px',
        borderRadius: 'var(--radius-full)',
        fontSize: 12,
        fontWeight: 600,
        border: '1px solid transparent',
        whiteSpace: 'nowrap',
        ...PILL_STYLES[variant],
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 'var(--radius-full)',
          flexShrink: 0,
          ...(pulse ? { animation: 'pulse 1.8s ease-in-out infinite' } : {}),
          ...PILL_DOT[variant],
        }}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stale headline banner
// ---------------------------------------------------------------------------

function StaleBanner({ staleCount, latestStartedAt }: { staleCount: number; latestStartedAt: string }) {
  if (staleCount === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '13px 16px',
        marginBottom: 18,
        borderRadius: 'var(--radius-lg)',
        background: 'var(--stale-badge-bg)',
        border: '1px solid var(--stale-badge-border)',
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--stale-badge-dot)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 1 }}
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--stale-badge-text)' }}>
          {staleCount} rollup{staleCount !== 1 ? 's are' : ' is'} serving stale cache — {staleCount !== 1 ? 'their' : 'its'} last refresh failed
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--warning-ink)', marginTop: 3, lineHeight: 1.5 }}>
          Dashboards still answer warm and look green, but the data is frozen.
          Latest sweep at{' '}
          <strong>
            {new Date(latestStartedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </strong>.
          Expand the sweep below to see which rollups are affected.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function KpiCard({
  label, value, note, flagged,
}: {
  label: string; value: string | number; note?: string; flagged?: boolean;
}) {
  return (
    <div
      style={{
        ...card,
        padding: '13px 15px',
        ...(flagged ? {
          borderColor: 'var(--stale-badge-border)',
          background: 'var(--stale-badge-bg)',
        } : {}),
      }}
    >
      <div style={{ ...eyebrow, ...(flagged ? { color: 'var(--stale-badge-text)' } : {}) }}>{label}</div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          lineHeight: 1.15,
          marginTop: 4,
          color: flagged ? 'var(--stale-badge-text)' : 'var(--text-primary)',
        }}
      >
        {value}
      </div>
      {note && (
        <div style={{ fontSize: 11.5, color: flagged ? 'var(--stale-badge-text)' : 'var(--text-muted)', marginTop: 2 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ---------------------------------------------------------------------------
// PreaggRunsTab — main export
// ---------------------------------------------------------------------------

export function PreaggRunsTab() {
  const { sweeps, loading, error } = usePreaggRuns(30);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { sweep: detailSweep, items: detailItems } = useSweepDetail(expandedId);

  // Build a map so each expanded sweep gets its items from the detail hook
  const itemsForSweep = (id: number): PreaggSweepItem[] | null => {
    if (expandedId !== id) return null;
    if (!detailItems.length && detailSweep?.id !== id) return null;
    return detailItems;
  };

  const latest = sweeps[0] ?? null;

  if (error) {
    return (
      <div
        role="tabpanel"
        id="hub-tab-panel-preagg-runs"
        aria-labelledby="hub-tab-preagg-runs"
        style={{ ...card, marginTop: 16, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '14px 16px', fontSize: 13 }}
      >
        Could not load pre-agg run history: {error}
      </div>
    );
  }

  return (
    <div
      role="tabpanel"
      id="hub-tab-panel-preagg-runs"
      aria-labelledby="hub-tab-preagg-runs"
      style={{ maxWidth: 1120, fontFamily: 'var(--font-sans)' }}
    >
      {/* Page header */}
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 18, marginTop: 16 }}>
        <div>
          <div style={eyebrow}>Cube · Pre-aggregations</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 9 }}>
            <Database size={22} style={{ color: 'var(--brand)', flexShrink: 0 }} />
            Refresh Runs
          </h2>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 560, lineHeight: 1.45 }}>
            History of the worker's hourly pre-aggregation sweeps. A failed sweep never
            wipes the cache — old partitions keep serving — so this is where you catch
            refreshes that <strong>silently fell behind</strong>.
          </p>
        </div>
        {latest && (
          <div style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.7, whiteSpace: 'nowrap' }}>
            sweep cadence&nbsp;·&nbsp;<strong style={{ color: 'var(--text-secondary)' }}>every 1h</strong> · all games<br />
            last sweep&nbsp;<strong style={{ color: 'var(--text-secondary)' }}>{fmtTime(latest.startedAt)}</strong>
            {latest.durationMs != null ? ` · ${fmtDuration(latest.durationMs)}` : ''}
          </div>
        )}
      </header>

      {/* Serveability now */}
      <ServeabilityStrip />

      {/* Stale banner — only when latest sweep has stale items */}
      {latest && latest.staleCount > 0 && (
        <StaleBanner staleCount={latest.staleCount} latestStartedAt={latest.startedAt} />
      )}

      {/* KPI row — latest sweep summary */}
      {latest && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
            marginBottom: 18,
          }}
        >
          <KpiCard
            label="Last sweep"
            value={fmtTime(latest.startedAt)}
            note={`${fmtDuration(latest.durationMs)} · ${latest.gamesCount} games`}
          />
          <KpiCard
            label="Sealed"
            value={latest.sealedCount}
            note="refreshed this sweep"
          />
          <KpiCard
            label="Stale-serving"
            value={latest.staleCount}
            note="failed, cache still up"
            flagged={latest.staleCount > 0}
          />
          <KpiCard
            label="Failed"
            value={latest.failedCount}
            note="not serveable"
          />
        </div>
      )}

      {/* Sweep history list */}
      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-card)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Sweep history</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>last 30 days · 1 row per hourly sweep</span>
        </div>

        {loading && sweeps.length === 0 ? (
          <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : sweeps.length === 0 ? (
          <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)' }}>
            No sweep history yet. The collector will populate this once PREAGG_COLLECTOR_ENABLED=true
            and the first pass completes.
          </div>
        ) : (
          sweeps.map((sweep) => (
            <SweepRow
              key={sweep.id}
              sweep={sweep}
              items={itemsForSweep(sweep.id)}
              expanded={expandedId === sweep.id}
              onToggle={() => setExpandedId(expandedId === sweep.id ? null : sweep.id)}
            />
          ))
        )}
      </section>
    </div>
  );
}
