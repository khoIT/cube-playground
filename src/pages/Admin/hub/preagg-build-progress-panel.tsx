/**
 * Live per-rollup checklist for a triggered pre-agg build.
 *
 * Renders under the trigger status line in the Pre-agg Runs tab while a
 * scoped build runs (and lingers after it finishes). Each rollup the worker
 * touches gets a line: spinning icon + "building…" while partitions are in
 * flight, then a coloured dot when it settles. Mirrors the segment-refresh
 * live checklist recipes (two-column grid, tokens only).
 *
 * Honesty: 'finished' means all observed partition builds completed — seals
 * are trace-only in worker logs, so final serveability lands via the probe.
 */

import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { BuildProgress, BuildRollupProgress, BuildRollupPhase } from '../../../types/preagg-run';

const SPIN_KEYFRAMES = '@keyframes preagg-build-spin{to{transform:rotate(360deg)}}';

const PHASE_DOT: Record<BuildRollupPhase, string> = {
  queued: 'var(--text-muted)',
  building: 'var(--info-ink)',
  finished: 'var(--success-ink)',
  failed: 'var(--destructive-ink)',
};

function RollupLine({ r }: { r: BuildRollupProgress }) {
  const building = r.phase === 'building';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 11.5, minWidth: 0, lineHeight: 1.7 }}>
      {building ? (
        <RefreshCw
          size={11}
          style={{ color: 'var(--info-ink)', flexShrink: 0, alignSelf: 'center', animation: 'preagg-build-spin 1s linear infinite' }}
        />
      ) : (
        <span style={{ width: 7, height: 7, borderRadius: 'var(--radius-full)', flexShrink: 0, alignSelf: 'center', background: PHASE_DOT[r.phase] }} />
      )}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: building ? 700 : 500,
          color: r.phase === 'failed' ? 'var(--destructive-ink)' : r.phase === 'queued' ? 'var(--text-muted)' : 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={r.errorMessage ?? r.id}
      >
        {r.cube}.{r.rollup}
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0, fontStyle: building ? 'italic' : 'normal' }}>
        {r.phase === 'failed'
          ? r.errorSig ?? 'failed'
          : building
            ? `building… ${r.partitionsCompleted}/${r.partitionsStarted}`
            : r.phase === 'finished'
              ? `${r.partitionsCompleted} partition${r.partitionsCompleted !== 1 ? 's' : ''}`
              : 'queued'}
      </span>
    </div>
  );
}

export function BuildProgressPanel({ progress }: { progress: BuildProgress | null }) {
  // Build started but the worker hasn't emitted per-rollup lines yet
  // (recreating the container + compiling schema) — show an honest sign.
  if (!progress || progress.rollups.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border-card)', fontSize: 11.5, color: 'var(--text-muted)' }}>
        <style>{SPIN_KEYFRAMES}</style>
        <RefreshCw size={12} style={{ color: 'var(--info-ink)', animation: 'preagg-build-spin 1s linear infinite' }} />
        Scoping worker + compiling schema… per-rollup progress appears once builds queue.
        {progress?.degraded && <span style={{ color: 'var(--destructive-ink)' }}>(docker logs unreadable — progress unavailable)</span>}
      </div>
    );
  }

  const { totals, rollups } = progress;
  const total = rollups.length;
  const settled = totals.finished + totals.failed;
  const live = progress.finishedAt === null;
  const pct = total > 0 ? Math.round((settled / total) * 100) : 0;
  const barColor = live
    ? 'var(--info-ink)'
    : totals.failed > 0 ? 'var(--destructive-ink)' : 'var(--success-ink)';

  return (
    <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--border-card)' }}>
      <style>{SPIN_KEYFRAMES}</style>

      {/* Header line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 7 }}>
        {live && <RefreshCw size={12} style={{ color: 'var(--info-ink)', animation: 'preagg-build-spin 1s linear infinite' }} />}
        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
          {live ? 'Building live' : 'Last build window'}
          {progress.game ? ` — ${progress.game}` : ''}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {settled}/{total} rollups · {totals.finished} finished · {totals.failed} failed
          {totals.building > 0 ? ` · ${totals.building} building` : ''}
          {!live ? ' · window closed' : ''}
        </span>
        {progress.degraded && (
          <span style={{ color: 'var(--destructive-ink)', fontSize: 11 }}>docker logs unreadable — view may be stale</span>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, borderRadius: 'var(--radius-full)', background: 'var(--muted-soft)', overflow: 'hidden', marginBottom: 9 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, transition: 'width 300ms ease' }} />
      </div>

      {/* Two-column rollup checklist */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24 }}>
        {rollups.map((r) => <RollupLine key={r.id} r={r} />)}
      </div>

      <div style={{ marginTop: 7, fontSize: 10.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        “finished” = all observed partition builds completed; seal confirmation lands on the
        serveability probe after the window closes.
      </div>
    </div>
  );
}
