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

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../api/api-client';
import type {
  DerivedRefreshState,
  SegmentRefreshOpsPayload,
  SegmentCardProgress,
  SegmentCardRun,
  SegmentCardStatus,
} from '../../../types/segment-refresh-ops';

export type { SegmentRefreshOpsPayload, SegmentCardProgress, SegmentCardRun, SegmentCardStatus };

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

/**
 * Poll one segment's live per-card refresh progress while `enabled`.
 *
 * `enabled` should track the row being expanded — polling continuously while
 * open is the simplest correct behaviour: it captures every transition (queued
 * → running → ok/error → a fresh pass) with no edge cases, and the poll is a
 * cheap in-memory read. The returned `progress` persists in state after polling
 * stops, so a completed pass stays visible until collapse.
 *
 * Best-effort: a missing run (process-local, may be on another gateway) returns
 * null. `onComplete` fires once per finished pass (tracked by finishedAt), so a
 * new refresh on the same row fires it again — letting the caller refetch the
 * ops list to reflect the settled state without re-firing on every poll.
 */
/**
 * Persisted per-card statuses (ok / serving-last-good / error) for one segment.
 * Fetched while `enabled` (row expanded); refetch after a live pass completes
 * so the checklist reflects the pass that just landed.
 */
export function useCardStatuses(segmentId: string, enabled: boolean) {
  const [cards, setCards] = useState<SegmentCardStatus[] | null>(null);

  const refetch = useCallback(() => {
    return apiFetch<{ cards: SegmentCardStatus[] }>(
      `/api/segment-refresh/${encodeURIComponent(segmentId)}/cards`,
    )
      .then((d) => setCards(d.cards))
      .catch((err: Error) => {
        console.warn('[segment-refresh] card-statuses fetch failed:', err.message);
      });
  }, [segmentId]);

  useEffect(() => {
    if (!enabled) return;
    void refetch();
  }, [enabled, refetch]);

  return { cards, refetch };
}

/**
 * Persisted card-pass history for one segment (newest first, server-capped).
 * Fetched only while `enabled` (the row is expanded) — one request per open,
 * re-fetched via `refetch` when a live pass completes so the strip picks up
 * the run that just finished. Unlike /progress this survives restarts.
 */
export function useRecentRuns(segmentId: string, enabled: boolean) {
  const [runs, setRuns] = useState<SegmentCardRun[] | null>(null);

  const refetch = useCallback(() => {
    return apiFetch<{ runs: SegmentCardRun[] }>(
      `/api/segment-refresh/${encodeURIComponent(segmentId)}/runs`,
    )
      .then((d) => setRuns(d.runs))
      .catch((err: Error) => {
        // Best-effort: the strip just stays hidden — but leave a trace so a
        // silently-missing history is debuggable from the console.
        console.warn('[segment-refresh] recent-runs fetch failed:', err.message);
      });
  }, [segmentId]);

  useEffect(() => {
    if (!enabled) return;
    void refetch();
  }, [enabled, refetch]);

  return { runs, refetch };
}

export function useCardProgress(
  segmentId: string,
  enabled: boolean,
  pollMs = 1500,
  onComplete?: () => void,
) {
  const [progress, setProgress] = useState<SegmentCardProgress | null>(null);
  // Last finishedAt we fired onComplete for — survives re-subscribes so a poll
  // that re-observes the same finished pass doesn't re-trigger a refetch.
  const lastFinishedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () =>
      void apiFetch<{ progress: SegmentCardProgress | null }>(
        `/api/segment-refresh/${encodeURIComponent(segmentId)}/progress`,
      )
        .then((d) => {
          if (cancelled) return;
          setProgress(d.progress);
          const fin = d.progress?.finishedAt ?? null;
          if (fin && fin !== lastFinishedRef.current) {
            lastFinishedRef.current = fin;
            onComplete?.();
          }
        })
        .catch(() => { /* progress is best-effort; stay quiet on transient errors */ });
    tick();
    const t = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [segmentId, enabled, pollMs, onComplete]);

  return { progress };
}
