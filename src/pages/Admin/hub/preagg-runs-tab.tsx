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

import React, { useState, useEffect } from 'react';
import { Database } from 'lucide-react';
import { usePreaggRuns, useSweepDetail, useServeabilityNow, useTriggerStatus, useBuildProgress, triggerBuild } from './preagg-runs-data';
import type { ServeabilityNow } from './preagg-runs-data';
import { SweepRow } from './preagg-runs-sweep-row';
import { PreaggReadinessMatrix } from './preagg-readiness-matrix';
import { BuildProgressPanel } from './preagg-build-progress-panel';
import { CubestoreStoragePanel } from './cubestore-storage-panel';
import { CubestoreQueryCacheChecker } from './cubestore-query-cache-checker';
import { useCubestoreStorage } from './cubestore-data';
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

function ServeabilityStrip({ data, loading, error, gameFilter }: {
  data: ServeabilityNow | null;
  loading: boolean;
  error: string | null;
  gameFilter: string | null;
}) {
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

  // When a game filter is active, scope the now-strip to that game's per-game
  // probe counts; otherwise show the cross-game totals.
  const g = gameFilter ? data?.games.find((x) => x.id === gameFilter) ?? null : null;
  const built = g ? g.built : data?.summary.built ?? 0;
  const fromSource = g ? g.fromSource : data?.summary.fromSource ?? 0;
  const unbuilt = g ? g.unbuilt : data?.summary.unbuilt ?? 0;
  const errored = g ? g.errored : data?.summary.errored ?? 0;
  const total = g ? g.built + g.fromSource + g.unbuilt + g.errored : data?.summary.totalRollups ?? 0;
  const games = gameFilter ? 1 : data?.summary.gamesCount ?? 0;
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
      <Pill variant="src"  label={`${fromSource} from source`} />
      <Pill variant="fail" label={`${errored} not serveable`} />
      <Pill variant="unb"  label={`${unbuilt} never built`} />

      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
        {gameFilter
          ? <><strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{gameFilter}</strong> · {total} rollups</>
          : <>across {games} games · {total} rollups</>}
        {' · '}
        <span style={{ fontStyle: 'italic' }}>failures attributed at rollup level; serveability is per-game</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pill component
// ---------------------------------------------------------------------------

type PillVariant = 'live' | 'stale' | 'src' | 'fail' | 'unb';

const PILL_STYLES: Record<PillVariant, React.CSSProperties> = {
  live:  { background: 'var(--live-badge-bg)',    borderColor: 'var(--live-badge-border)',    color: 'var(--live-badge-text)' },
  stale: { background: 'var(--stale-badge-bg)',   borderColor: 'var(--stale-badge-border)',   color: 'var(--stale-badge-text)' },
  src:   { background: 'var(--info-soft)',        borderColor: 'var(--info-ink)',             color: 'var(--info-ink)' },
  fail:  { background: 'var(--destructive-soft)', borderColor: 'var(--destructive-ink)',     color: 'var(--destructive-ink)' },
  unb:   { background: 'var(--muted-soft)',        borderColor: 'var(--border-card)',          color: 'var(--muted-ink)' },
};

const PILL_DOT: Record<PillVariant, React.CSSProperties> = {
  live:  { background: 'var(--live-badge-dot)' },
  stale: { background: 'var(--stale-badge-dot)' },
  src:   { background: 'var(--info-ink)' },
  fail:  { background: 'var(--danger)' },
  unb:   { background: 'var(--fill-muted)' },
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
  const { sweeps, loading, error, refetch: refetchSweeps } = usePreaggRuns(30);
  const { data: serveability, loading: serveLoading, error: serveError, refetch: refetchServe } = useServeabilityNow();
  const { status: triggerStatus, refetch: refetchTrigger } = useTriggerStatus();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [gameFilter, setGameFilter] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  // Probe snapshots are state samples (collector pass with no worker sweep in
  // the log window), not worker activity — hidden by default so the history
  // reads as "what the worker did".
  const [showSnapshots, setShowSnapshots] = useState(false);
  // CubeStore storage introspection is a separate, heavier read (MySQL wire to
  // system.*) — collapsed by default; only fetches when opened.
  const [cubestoreOpen, setCubestoreOpen] = useState(false);
  const { data: cubestoreData, loading: cubestoreLoading, error: cubestoreError } = useCubestoreStorage(cubestoreOpen);
  const { sweep: detailSweep, items: detailItems } = useSweepDetail(expandedId);

  // Game options for the filter — sourced from the live probe (id + label).
  const gameOptions = serveability?.games ?? [];

  const buildRunning = triggerStatus?.state.phase === 'running';
  const triggerEnabled = triggerStatus?.enabled ?? false;

  // Live per-rollup build stream — polls while a build runs; the last snapshot
  // (and the server's lingering window) keeps the finished checklist visible.
  const { progress: buildProgress } = useBuildProgress(buildRunning);

  const handleRebuild = async (game?: string) => {
    if (buildRunning) return;
    const target = game ?? gameFilter;
    if (!target) {
      // Stay clickable when "All games" is selected, but explain rather than
      // rebuild every game at once (each is a multi-minute scoped sweep).
      setTriggerError('Pick a game in the filter above to rebuild its pre-aggregations.');
      return;
    }
    setTriggerError(null);
    const err = await triggerBuild(target);
    if (err) setTriggerError(err);
    refetchTrigger();
  };

  // When a build finishes, refresh serveability + history so the UI reflects
  // the freshly sealed partitions without a manual reload. Two cadence quirks
  // make a single refetch insufficient:
  //   - /current is a non-blocking 60s probe cache: the first refetch returns
  //     the stale pre-build snapshot and only KICKS a background re-probe.
  //   - the triggered-build history row is written in the trigger's finally,
  //     just AFTER phase flips to 'done' (behind an async worker-log read), so
  //     the immediate refetchSweeps can race ahead of the row landing.
  // So re-poll BOTH a couple of times to pick up the recomputed result + row.
  const buildPhase = triggerStatus?.state.phase;
  useEffect(() => {
    if (buildPhase !== 'done') return;
    refetchServe();
    refetchSweeps();
    const t1 = setTimeout(() => { refetchServe(); refetchSweeps(); }, 8_000);
    const t2 = setTimeout(() => { refetchServe(); refetchSweeps(); }, 25_000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [buildPhase, refetchServe, refetchSweeps]);

  // A finished build RESOLVES into sweep history: the trigger records the build
  // window directly as a `triggered-build` row at window close (started_at =
  // the trigger's own start). Once that row appears, the ephemeral status line +
  // checklist are redundant and auto-dismiss; the history row is the durable
  // record. A 10-min fallback (matching the server's progress linger) covers a
  // missed write. Failed builds stay visible — the operator must see them.
  const buildStartedAtMs = triggerStatus?.state.startedAt ? Date.parse(triggerStatus.state.startedAt) : null;
  const buildFinishedAtMs = triggerStatus?.state.finishedAt ? Date.parse(triggerStatus.state.finishedAt) : null;
  const buildResolvedIntoHistory =
    buildPhase === 'done' &&
    buildStartedAtMs !== null &&
    sweeps.some(
      (s) =>
        (s.source === 'triggered-build' || s.source === 'scheduled') &&
        Date.parse(s.startedAt) >= buildStartedAtMs,
    );
  const buildLingerExpired =
    buildPhase === 'done' && buildFinishedAtMs !== null && Date.now() - buildFinishedAtMs > 10 * 60_000;
  const showBuildBlock =
    buildRunning ||
    buildPhase === 'error' ||
    (buildPhase === 'done' && !buildResolvedIntoHistory && !buildLingerExpired);

  // Build a map so each expanded sweep gets its items from the detail hook
  const itemsForSweep = (id: number): PreaggSweepItem[] | null => {
    if (expandedId !== id) return null;
    if (!detailItems.length && detailSweep?.id !== id) return null;
    return detailItems;
  };

  // Header/KPIs describe WORKER activity — skip probe snapshots, which would
  // otherwise report a 0s "sweep" that never ran anything.
  const latest = sweeps.find((s) => s.source === 'scheduled') ?? null;
  // Always show scheduled sweeps AND on-demand build records (both are real
  // work); only probe snapshots hide behind the toggle.
  const visibleSweeps = showSnapshots
    ? sweeps
    : sweeps.filter((s) => s.source === 'scheduled' || s.source === 'triggered-build');

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
            Live rollup readiness per game (<strong>what still needs a build</strong>) plus the
            worker's sweep history (<strong>what just ran</strong>). A failed sweep never wipes
            the cache — old partitions keep serving — so this is where you catch refreshes
            that silently fell behind.
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
      <ServeabilityStrip
        data={serveability}
        loading={serveLoading}
        error={serveError}
        gameFilter={gameFilter}
      />

      {/* Rollup readiness matrix — current state per game × cube, with in-place
          build actions. The sweep history below is the event log; this is the
          "what still needs building" view. */}
      <PreaggReadinessMatrix
        games={serveability?.games ?? []}
        generatedAt={serveability?.generatedAt ?? null}
        triggerEnabled={triggerEnabled}
        buildingGame={buildRunning ? triggerStatus?.state.game ?? null : null}
        onBuild={(game) => void handleRebuild(game)}
      />

      {/* CubeStore storage — what's actually materialised + a per-query cache
          checker. Collapsed by default (heavier system.* read); fetches on open. */}
      <section style={{ marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => setCubestoreOpen((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            borderRadius: cubestoreOpen ? 'var(--radius-lg) var(--radius-lg) 0 0' : 'var(--radius-lg)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text-muted)', transform: cubestoreOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>▸</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>CubeStore storage</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>what's materialised · does a query serve from cache</span>
        </button>
        {cubestoreOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', border: '1px solid var(--border-card)', borderTop: 'none', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)' }}>
            <CubestoreStoragePanel data={cubestoreData} loading={cubestoreLoading} error={cubestoreError} />
            {gameOptions.length > 0 && (
              <CubestoreQueryCacheChecker games={gameOptions.map((g) => ({ id: g.id, label: g.label }))} />
            )}
          </div>
        )}
      </section>

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
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>last 30 days · 1 row per worker sweep</span>

          {/* Probe snapshots are point-in-time state samples, not runs — opt-in. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showSnapshots}
              onChange={(e) => setShowSnapshots(e.target.checked)}
              style={{ accentColor: 'var(--brand)', margin: 0 }}
            />
            show probe snapshots
          </label>

          {/* Game filter — scopes the now-strip + expanded detail rows. */}
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-muted)' }}>
            Game
            <select
              value={gameFilter ?? ''}
              onChange={(e) => setGameFilter(e.target.value || null)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">All games</option>
              {gameOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.id} · {g.label}</option>
              ))}
            </select>
          </label>

          {/* Build trigger — scopes the worker to the selected game, rebuilds,
              then restores the all-games sweep. Only shown when enabled on the host. */}
          {triggerEnabled && (
            <button
              type="button"
              onClick={() => void handleRebuild()}
              disabled={buildRunning}
              title={buildRunning ? 'A build is already running' : gameFilter ? `Rebuild ${gameFilter}'s pre-aggregations now` : 'Pick a game in the filter to rebuild'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 12px',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                color: 'var(--brand)',
                background: 'var(--brand-soft)',
                border: '1px solid var(--brand)',
                borderRadius: 'var(--radius-sm)',
                cursor: buildRunning ? 'not-allowed' : 'pointer',
                opacity: buildRunning ? 0.55 : gameFilter ? 1 : 0.8,
              }}
            >
              {buildRunning && (
                <span style={{ width: 7, height: 7, borderRadius: 'var(--radius-full)', background: 'var(--brand)', animation: 'pulse 1.8s ease-in-out infinite' }} />
              )}
              {buildRunning ? `Building ${triggerStatus?.state.game}…` : 'Rebuild'}
            </button>
          )}
        </div>

        {/* Trigger status / error line — auto-dismissed once the finished
            build resolves into a sweep-history row below. */}
        {triggerEnabled && (triggerError || showBuildBlock) && (
          <div
            style={{
              padding: '8px 16px',
              borderBottom: '1px solid var(--border-card)',
              fontSize: 11.5,
              color: triggerError || buildPhase === 'error' ? 'var(--destructive-ink)' : 'var(--text-muted)',
              background: triggerError || buildPhase === 'error' ? 'var(--destructive-soft)' : 'var(--bg-muted)',
            }}
          >
            {triggerError
              ? triggerError
              : `${buildPhase === 'done' ? '✓ ' : ''}${triggerStatus?.state.message ?? ''}`}
          </div>
        )}

        {/* Live per-rollup build checklist — shown while a triggered build
            runs, keeps the final states readable after it closes, then
            auto-dismisses with the status line once history has the record. */}
        {triggerEnabled && showBuildBlock && (buildRunning || buildProgress) && (
          <BuildProgressPanel progress={buildProgress} />
        )}

        {loading && sweeps.length === 0 ? (
          <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : visibleSweeps.length === 0 ? (
          <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)' }}>
            {sweeps.length > 0
              ? 'No worker sweeps in the window — only probe snapshots (tick the box above to see them). The worker may not have run a scheduled refresh yet.'
              : 'No sweep history yet. The collector will populate this once PREAGG_COLLECTOR_ENABLED=true and the first pass completes.'}
          </div>
        ) : (
          visibleSweeps.map((sweep) => (
            <SweepRow
              key={sweep.id}
              sweep={sweep}
              items={itemsForSweep(sweep.id)}
              expanded={expandedId === sweep.id}
              onToggle={() => setExpandedId(expandedId === sweep.id ? null : sweep.id)}
              gameFilter={gameFilter}
              onRetry={triggerEnabled ? (game) => void handleRebuild(game) : undefined}
              retryDisabled={buildRunning}
            />
          ))
        )}
      </section>
    </div>
  );
}
