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
import type { PreaggSweep, PreaggSweepItem } from '../../../types/preagg-run';

// ---------------------------------------------------------------------------
// Re-export types used by the tab components
// ---------------------------------------------------------------------------
export type { PreaggSweep, PreaggSweepItem };

// ---------------------------------------------------------------------------
// /current response shape (mirrors routes/preagg-runs.ts)
// ---------------------------------------------------------------------------

export interface GameReadinessSummary {
  id: string;
  label: string;
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

  return { data, loading, error, refetch };
}
