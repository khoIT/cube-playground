/**
 * Fetch hook for the cache-effectiveness endpoint.
 * Uses AbortController — cancels in-flight request when deps change.
 * Provides a `refresh` tick to force re-fetch without changing filters.
 */

import { useState, useEffect, useCallback } from 'react';
import { getOwnerId } from '../../api/chat-owner-id';
import type { CacheEffectivenessResponse } from '../../api/cache-effectiveness-types';

interface Params {
  /** Game id to scope, or undefined for "all owner's games" */
  gameId?: string;
  /** Window in days: 7, 30, or 90 */
  days: number;
  /** Max rows returned in topQueries (1–100) */
  topN?: number;
}

interface CacheEffectivenessState {
  data: CacheEffectivenessResponse | null;
  isLoading: boolean;
  error: string | null;
  /** Call to force a re-fetch with the same filters */
  refresh: () => void;
}

export function useCacheEffectiveness(params: Params): CacheEffectivenessState {
  const [data, setData] = useState<CacheEffectivenessResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumping this triggers a re-fetch while keeping the same filter deps
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    const qp = new URLSearchParams({ days: String(params.days) });
    if (params.gameId) qp.set('game', params.gameId);
    if (params.topN != null) qp.set('topN', String(params.topN));

    fetch(`/api/chat/debug/cache-effectiveness?${qp.toString()}`, {
      headers: { 'X-Owner-Id': getOwnerId() },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<CacheEffectivenessResponse>;
      })
      .then((payload) => {
        setData(payload);
        setIsLoading(false);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setData(null);
        setError(err.message);
        setIsLoading(false);
      });

    return () => controller.abort();
    // tick is intentionally a dep so refresh() triggers a refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.gameId, params.days, params.topN, tick]);

  return { data, isLoading, error, refresh };
}
