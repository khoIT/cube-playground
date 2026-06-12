/**
 * Data hooks for the Pre-agg Runs tab.
 *
 * Three hooks mirror the observability-data.ts pattern:
 *   usePreaggRuns()       — GET /api/preagg-runs?limit=30 (sweep list)
 *   useSweepDetail(id)    — GET /api/preagg-runs/:id (sweep + items)
 *   useServeabilityNow()  — GET /api/preagg-runs/current (live probe + collector)
 *
 * All requests go through apiFetch (auto Bearer JWT) — the routes require
 * admin role, so a bare fetch() would 401 in real-auth mode.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';
import type { PreaggSweep, PreaggSweepItem, BuildProgress } from '../../../types/preagg-run';

// ---------------------------------------------------------------------------
// Re-export types used by the tab components
// ---------------------------------------------------------------------------
export type { PreaggSweep, PreaggSweepItem, BuildProgress };

// ---------------------------------------------------------------------------
// /current response shape (mirrors routes/preagg-runs.ts)
// ---------------------------------------------------------------------------

/** One probed cube's classification (mirrors ProbeResult in preagg-readiness). */
export interface ProbeCubeResult {
  cube: string;
  status: 'built' | 'unbuilt' | 'error';
  message?: string;
  /** Most recent seal observed in sweep history for this game × cube. */
  lastSealedAt?: string | null;
}

export interface GameReadinessSummary {
  id: string;
  label: string;
  /** Per-cube probe results — the readiness matrix renders these as cells. */
  cubes?: ProbeCubeResult[];
  built: number;
  unbuilt: number;
  errored: number;
}

export interface ServeabilityNow {
  generatedAt: string;
  note: string | null;
  games: GameReadinessSummary[];
  summary: {
    gamesCount: number;
    totalRollups: number;
    built: number;
    unbuilt: number;
    errored: number;
  };
  collector: {
    status: 'online' | 'degraded' | 'disabled';
    lastError: string | null;
    lastPassAt: string | null;
  };
  /** True when the probe is still computing (cold) and no cache exists yet. */
  warming?: boolean;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function usePreaggRuns(limit = 30) {
  const [sweeps, setSweeps] = useState<PreaggSweep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ sweeps: PreaggSweep[] }>(`/api/preagg-runs?limit=${limit}`)
      .then((data) => setSweeps(data.sweeps ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => { refetch(); }, [refetch]);

  return { sweeps, loading, error, refetch };
}

export function useSweepDetail(id: number | null) {
  const [sweep, setSweep] = useState<PreaggSweep | null>(null);
  const [items, setItems] = useState<PreaggSweepItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    setLoading(true);
    setError(null);
    apiFetch<{ sweep: PreaggSweep; items: PreaggSweepItem[] }>(`/api/preagg-runs/${id}`)
      .then((data) => { setSweep(data.sweep); setItems(data.items ?? []); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  return { sweep, items, loading, error };
}

// ---------------------------------------------------------------------------
// Build trigger (dev/demo)
// ---------------------------------------------------------------------------

export interface TriggerState {
  phase: 'idle' | 'running' | 'done' | 'error';
  game: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
  exitCode: number | null;
}

export interface TriggerStatus {
  enabled: boolean;
  state: TriggerState;
}

/** Poll trigger status; polls fast while a build is running, slow otherwise. */
export function useTriggerStatus() {
  const [status, setStatus] = useState<TriggerStatus | null>(null);

  const refetch = useCallback(() => {
    apiFetch<TriggerStatus>('/api/preagg-runs/trigger/status')
      .then(setStatus)
      .catch(() => { /* trigger status is best-effort; ignore transient errors */ });
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // While a build runs, poll every 3s so the UI reflects progress + completion.
  const running = status?.state.phase === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refetch, 3000);
    return () => clearInterval(t);
  }, [running, refetch]);

  return { status, refetch };
}

/**
 * Poll live per-rollup build progress while `active` (a triggered build is
 * running). The last snapshot persists in state after polling stops, so the
 * finished checklist stays visible instead of vanishing when the build ends —
 * the server also lingers the finished window, so a late mount still gets it.
 */
export function useBuildProgress(active: boolean, pollMs = 2500) {
  const [progress, setProgress] = useState<BuildProgress | null>(null);

  const refetch = useCallback(() => {
    apiFetch<{ progress: BuildProgress | null }>('/api/preagg-runs/build-progress')
      .then((d) => {
        // Keep the last non-null snapshot: a transient null (e.g. trigger state
        // resetting) shouldn't blank a checklist the operator is reading.
        setProgress((prev) => d.progress ?? prev);
      })
      .catch(() => { /* best-effort live view; ignore transient errors */ });
  }, []);

  // Fetch once on mount (picks up an in-flight or lingering build), then poll
  // while active — plus one trailing fetch when active flips off so the final
  // per-rollup states land.
  useEffect(() => { refetch(); }, [refetch]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(refetch, pollMs);
    return () => { clearInterval(t); refetch(); };
  }, [active, pollMs, refetch]);

  return { progress };
}

/** POST a build trigger for one game. Resolves to an error string or null. */
export async function triggerBuild(game: string): Promise<string | null> {
  try {
    await apiFetch('/api/preagg-runs/trigger', {
      method: 'POST',
      body: { game },
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Failed to start build';
  }
}

export function useServeabilityNow() {
  const [data, setData] = useState<ServeabilityNow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ServeabilityNow>('/api/preagg-runs/current')
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // Cold start: the first probe warms in the background. Poll until it lands
  // so the strip fills in on its own instead of needing a manual reload.
  useEffect(() => {
    if (!data?.warming) return;
    const t = setTimeout(refetch, 4000);
    return () => clearTimeout(t);
  }, [data?.warming, refetch]);

  // Steady slow poll: the worker auto-refreshes hourly and the server probe
  // cache re-warms in the background, so without this the chips only update
  // on a manual reload.
  useEffect(() => {
    const t = setInterval(refetch, 60_000);
    return () => clearInterval(t);
  }, [refetch]);

  return { data, loading, error, refetch };
}
