/**
 * useCohortGrid — data hook for the cohort retention grid.
 *
 * Phase-2 caching change: the FE reads from /api/liveops/cohort instead of
 * issuing Cube /load directly. The server detects server-side retention cube
 * vs absent and produces the appropriate rows; the FE never has to
 * client-pivot anymore.
 *
 * 202 warming responses retry with exponential backoff capped at 10s.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { liveopsClient, type CohortGridPayload, type CachedView } from '../../../api/liveops-client';
import type { CohortRow } from './pivot-cohort-rows';

export type CohortWindow = 7 | 14 | 28;
export type DataPath = 'server' | 'client' | 'detecting';

export interface UseCohortGridResult {
  rows: CohortRow[];
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  dataPath: DataPath;
}

const WARMING_RETRY_BASE_MS = 1_500;
const WARMING_RETRY_MAX_MS = 10_000;

function isCached<T>(r: { status?: string }): r is CachedView<T> {
  return r.status === 'fresh' || r.status === 'refreshing';
}

export function useCohortGrid(
  gameId: string,
  cohortWindow: CohortWindow,
): UseCohortGridResult {
  const [rows, setRows] = useState<CohortRow[]>([]);
  const [status, setStatus] = useState<UseCohortGridResult['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dataPath, setDataPath] = useState<DataPath>('detecting');
  const gameIdRef = useRef(gameId);
  const windowRef = useRef(cohortWindow);

  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);
  useEffect(() => { windowRef.current = cohortWindow; }, [cohortWindow]);

  const fetchOnce = useCallback(
    async (signal: AbortSignal, attempt = 0): Promise<void> => {
      const g = gameIdRef.current;
      const w = windowRef.current;
      try {
        const res = await liveopsClient.cohortGrid(g, w);
        if (signal.aborted) return;
        if (g !== gameIdRef.current || w !== windowRef.current) return;

        if (isCached<CohortGridPayload>(res) && Array.isArray(res.payload?.rows)) {
          setDataPath(res.payload.dataPath === 'unavailable' ? 'client' : res.payload.dataPath);
          setRows(res.payload.rows);
          setStatus('success');
          setError(null);
          return;
        }

        // 202 warming
        setStatus('loading');
        const delay = Math.min(WARMING_RETRY_BASE_MS * Math.pow(2, attempt), WARMING_RETRY_MAX_MS);
        setTimeout(() => {
          if (!signal.aborted) void fetchOnce(signal, attempt + 1);
        }, delay);
      } catch (err: unknown) {
        if (signal.aborted) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  useEffect(() => {
    setRows([]);
    setStatus('loading');
    setError(null);
    setDataPath('detecting');
    const controller = new AbortController();
    void fetchOnce(controller.signal);
    return () => controller.abort();
  }, [gameId, cohortWindow, fetchOnce]);

  return { rows, status, error, dataPath };
}
