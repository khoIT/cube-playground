/**
 * SegmentRefreshOpsTab — "Segment Refreshes" panel in the sys-admin hub.
 *
 * Sibling to Pre-agg Runs: that tab watches the worker's hourly rollup sweeps
 * (path C); this one watches the gateway's segment-refresh cron (path B) — the
 * per-cohort + KPI-card recompute. Surfaces the two signals nothing else shows:
 * `wedged` (stuck mid-refresh) and `degraded` (cohort fine, cards cold-failing).
 *
 * Layout: page header → cron heartbeat strip (last tick, queue depth, wedged/
 * degraded counts, watchdog state) → segment table (alert states sorted first).
 * Tokens only; mirrors preagg-runs-tab.tsx recipes. Per-instance — shows the
 * gateway that served the request.
 */

import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import {
  useSegmentRefreshOps,
  refreshSegmentNow,
  unstickSegment,
  fmtAge,
} from './segment-refresh-ops-data';
import { SegmentRefreshRow } from './segment-refresh-row';
import type { DerivedRefreshState } from '../../../types/segment-refresh-ops';

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

// Alert states float to the top so an operator sees trouble without scrolling.
const STATE_SORT: Record<DerivedRefreshState, number> = {
  wedged: 0, broken: 1, degraded: 2, serving_stale: 3, due: 4, in_flight: 5, healthy: 6,
};

function HeartStat({ label, value, flagged }: { label: string; value: string | number; flagged?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 14, borderRight: '1px solid var(--border-card)' }}>
      <span style={eyebrow}>{label}</span>
      <span style={{ fontSize: 19, fontWeight: 700, lineHeight: 1, color: flagged ? 'var(--destructive-ink)' : 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function HeartbeatStrip({
  lastTickAt, sinceLastTickMs, queueSize, queueProcessing, wedged, degraded, watchdogEnabled, wedgeFloorMin,
}: {
  lastTickAt: string | null;
  sinceLastTickMs: number | null;
  queueSize: number;
  queueProcessing: boolean;
  wedged: number;
  degraded: number;
  watchdogEnabled: boolean;
  wedgeFloorMin: number;
}) {
  // Heartbeat is suspect if the last tick is older than ~2.5 intervals.
  const stale = sinceLastTickMs != null && sinceLastTickMs > 150_000;
  return (
    <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', marginBottom: 14, flexWrap: 'wrap' }}>
      <HeartStat
        label="Last cron tick"
        value={lastTickAt ? fmtAge(sinceLastTickMs) : 'never'}
        flagged={stale}
      />
      <HeartStat label="Queue" value={queueProcessing ? `${queueSize} · running` : queueSize} />
      <HeartStat label="Wedged" value={wedged} flagged={wedged > 0} />
      <HeartStat label="Degraded" value={degraded} flagged={degraded > 0} />
      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
        watchdog{' '}
        <strong style={{ color: watchdogEnabled ? 'var(--success-ink)' : 'var(--text-muted)' }}>
          {watchdogEnabled ? 'on' : 'off'}
        </strong>
        {' '}· auto-unsticks after {wedgeFloorMin}m+
      </span>
    </div>
  );
}

export function SegmentRefreshOpsTab() {
  // Poll every 30s so the heartbeat + queue depth stay live while watched.
  const { data, loading, error, refetch } = useSegmentRefreshOps(30_000);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const runAction = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setBusy(id, true);
    try {
      await fn(id);
      await refetch();
    } catch {
      // Surfaced on next poll; keep the UI quiet on a single failed click.
    } finally {
      setBusy(id, false);
    }
  };

  const sorted = useMemo(() => {
    const segs = data?.segments ?? [];
    return [...segs].sort((a, b) => {
      const d = STATE_SORT[a.derivedState] - STATE_SORT[b.derivedState];
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  }, [data]);

  if (error) {
    return (
      <div
        role="tabpanel"
        id="hub-tab-panel-segment-refreshes"
        aria-labelledby="hub-tab-segment-refreshes"
        style={{ ...card, marginTop: 16, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '14px 16px', fontSize: 13 }}
      >
        Could not load segment-refresh ops: {error}
      </div>
    );
  }

  const s = data?.summary;

  return (
    <div
      role="tabpanel"
      id="hub-tab-panel-segment-refreshes"
      aria-labelledby="hub-tab-segment-refreshes"
      style={{ maxWidth: 1120, fontFamily: 'var(--font-sans)' }}
    >
      {/* Page header */}
      <header style={{ marginBottom: 18, marginTop: 16 }}>
        <div style={eyebrow}>Segments · Background refresh</div>
        <h2 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Activity size={22} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          Segment Refreshes
        </h2>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 620, lineHeight: 1.45 }}>
          Health of the segment-refresh cron — the per-cohort + KPI-card recompute. Catches segments
          that are <strong>wedged mid-refresh</strong> or <strong>serving cold-failing cards</strong>.
          Per-instance: shows the gateway that served this page.
        </p>
      </header>

      {data && (
        <HeartbeatStrip
          lastTickAt={data.cron.lastTickAt}
          sinceLastTickMs={data.cron.sinceLastTickMs}
          queueSize={data.queue.size}
          queueProcessing={data.queue.processing}
          wedged={s?.wedged ?? 0}
          degraded={s?.degraded ?? 0}
          watchdogEnabled={data.watchdog.enabled}
          wedgeFloorMin={data.watchdog.wedgeFloorMin}
        />
      )}

      {/* Segment table */}
      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Live segments</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {s ? `${s.total} predicate segments · alerts first` : 'predicate segments'}
          </span>
        </div>

        {loading && !data ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            No live (predicate) segments on this gateway yet.
          </div>
        ) : (
          sorted.map((row) => (
            <SegmentRefreshRow
              key={row.id}
              row={row}
              busy={busyIds.has(row.id)}
              onRefresh={(id) => void runAction(id, refreshSegmentNow)}
              onUnstick={(id) => void runAction(id, unstickSegment)}
            />
          ))
        )}
      </section>
    </div>
  );
}
