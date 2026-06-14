/**
 * Data hook for the Care Precompute board (sys-admin hub).
 *
 *   useCarePrecompute()  — GET /api/admin/care-precompute/runs (runs + cache freshness)
 *   triggerCarePrecompute(id) — POST a manual "run now" (202 / 429 cooldown)
 *
 * All requests go through apiFetch (auto Bearer JWT) — the routes require admin
 * role. Mirrors preagg-runs-data.ts.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

export interface CareRun {
  id: number;
  segmentId: string;
  gameId: string;
  source: 'cron' | 'manual';
  startedAt: string;
  finishedAt: string | null;
  status: 'ok' | 'error';
  tickets: number | null;
  contacted: number | null;
  elapsedMs: number | null;
  runError: string | null;
}

export interface CareCacheStatus {
  segmentId: string;
  gameId: string;
  computedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  status: 'ok' | 'error';
  hasPayload: boolean;
}

export interface CarePrecomputeResponse {
  runs: CareRun[];
  cache: CareCacheStatus[];
  /** Nightly window in minutes-of-day GMT+7. */
  window: { startMin: number; endMin: number };
}

export function useCarePrecompute(pollMs = 60_000) {
  const [data, setData] = useState<CarePrecomputeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<CarePrecomputeResponse>('/api/admin/care-precompute/runs')
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const t = setInterval(refetch, pollMs);
    return () => clearInterval(t);
  }, [pollMs, refetch]);

  return { data, loading, error, refetch };
}

/** POST a manual care precompute. Resolves to an error string, or null on 202. */
export async function triggerCarePrecompute(segmentId: string): Promise<string | null> {
  try {
    await apiFetch('/api/admin/care-precompute/runs', {
      method: 'POST',
      body: { segmentId },
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Failed to trigger precompute';
  }
}

/** Render the nightly window (minutes-of-day GMT+7) as "03:00–06:00". */
export function fmtWindow(w: { startMin: number; endMin: number }): string {
  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  return `${hhmm(w.startMin)}–${hhmm(w.endMin)}`;
}
