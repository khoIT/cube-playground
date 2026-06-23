/**
 * Hook: fetch lifecycle state counts for the active game.
 *
 * Wraps GET /api/lifecycle-flow. Returns loading/error/data in the same
 * shape as other liveops hooks. Aborts the in-flight request on game change
 * or unmount to avoid stale-state overwrites.
 */
import { useState, useEffect } from 'react';
import {
  fetchLifecycleFlow,
  type LifecycleFlowResponse,
} from '../../../../api/lifecycle-flow-client';

export interface UseLifecycleFlowResult {
  data: LifecycleFlowResponse | null;
  loading: boolean;
  error: string | null;
}

export function useLifecycleFlow(gameId: string): UseLifecycleFlowResult {
  const [data, setData] = useState<LifecycleFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;

    const ctl = new AbortController();
    setLoading(true);
    setError(null);

    fetchLifecycleFlow(gameId, ctl.signal)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load lifecycle data');
        setLoading(false);
      });

    return () => ctl.abort();
  }, [gameId]);

  return { data, loading, error };
}
