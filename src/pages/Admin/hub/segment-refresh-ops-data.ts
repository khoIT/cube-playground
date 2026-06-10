/**
 * Data layer for the Segment Refreshes tab.
 *
 *   useSegmentRefreshOps()       — GET /api/segment-refresh/ops (full picture)
 *   useSegmentRefreshAlertCount() — wedged+degraded count for the hub nav badge
 *   unstickSegment(id)           — POST /api/segment-refresh/:id/unstick
 *   refreshSegmentNow(id)        — POST /api/segments/:id/refresh (reuse)
 *
 * Plus pure presentation helpers (stateMeta, fmtAge) kept here so they're
 * unit-testable without rendering. All requests go through apiFetch (auto Bearer
 * JWT) — the routes are admin-gated.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';
import type {
  DerivedRefreshState,
  SegmentRefreshOpsPayload,
} from '../../../types/segment-refresh-ops';

export type { SegmentRefreshOpsPayload };

// ---------------------------------------------------------------------------
// Pure presentation helpers
// ---------------------------------------------------------------------------

export type StateTone = 'positive' | 'info' | 'warning' | 'destructive' | 'muted';

export interface StateMeta {
  label: string;
  tone: StateTone;
  blurb: string;
}

const STATE_META: Record<DerivedRefreshState, StateMeta> = {
  healthy:       { label: 'Healthy',       tone: 'positive',    blurb: 'Refreshed on cadence, all cards warm' },
  due:           { label: 'Due',           tone: 'muted',       blurb: 'Past cadence, awaiting next tick' },
  in_flight:     { label: 'Refreshing',    tone: 'info',        blurb: 'Actively refreshing now' },
  wedged:        { label: 'Wedged',        tone: 'destructive', blurb: 'Stuck mid-refresh — orphaned' },
  serving_stale: { label: 'Serving stale', tone: 'warning',     blurb: 'Last refresh failed; serving last-good' },
  broken:        { label: 'Broken',        tone: 'destructive', blurb: 'Hard failure' },
  degraded:      { label: 'Degraded',      tone: 'warning',     blurb: 'Cohort OK, but ≥1 KPI card failing its refresh (may serve last-good)' },
};

export function stateMeta(state: DerivedRefreshState): StateMeta {
  return STATE_META[state] ?? { label: state, tone: 'muted', blurb: '' };
}

/** States that warrant operator attention (drive the nav badge + sort order). */
export function isAlertState(state: DerivedRefreshState): boolean {
  return state === 'wedged' || state === 'degraded' || state === 'broken';
}

/** Human-readable relative age. null → "never". */
export function fmtAge(ms: number | null): string {
  if (ms == null) return 'never';
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}

export function fmtCadence(min: number | null): string {
  if (!min || min <= 0) return '—';
  if (min < 60) return `${min}m`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useSegmentRefreshOps(pollMs = 0) {
  const [data, setData] = useState<SegmentRefreshOpsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    return apiFetch<SegmentRefreshOpsPayload>('/api/segment-refresh/ops')
      .then((d) => setData(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void refetch();
    if (pollMs <= 0) return;
    const t = setInterval(() => void refetch(), pollMs);
    return () => clearInterval(t);
  }, [refetch, pollMs]);

  return { data, loading, error, refetch };
}

/** Lightweight count for the hub nav badge — wedged + degraded only. */
export function useSegmentRefreshAlertCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    apiFetch<SegmentRefreshOpsPayload>('/api/segment-refresh/ops')
      .then((d) => {
        if (alive) setCount((d.summary?.wedged ?? 0) + (d.summary?.degraded ?? 0));
      })
      .catch(() => { /* badge is best-effort; stay silent on error */ });
    return () => { alive = false; };
  }, []);
  return count;
}

export function unstickSegment(id: string): Promise<{ id: string; unstuck: boolean; status: string }> {
  return apiFetch(`/api/segment-refresh/${encodeURIComponent(id)}/unstick`, { method: 'POST' });
}

export function refreshSegmentNow(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/segments/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
}
