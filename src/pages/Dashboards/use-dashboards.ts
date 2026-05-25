/**
 * SWR-style hook: lists dashboards for the active game.
 * Re-fetches when gameId changes. Exposes refetch for post-mutation refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardsClient, type Dashboard } from '../../api/dashboards-client';

interface UseDashboardsResult {
  dashboards: Dashboard[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDashboards(gameId: string): UseDashboardsResult {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetch = useCallback(() => {
    if (!gameId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    dashboardsClient
      .list(gameId)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setDashboards(data);
      })
      .catch((err: Error) => {
        if (ctrl.signal.aborted) return;
        setError(err.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
  }, [gameId]);

  useEffect(() => {
    fetch();
    return () => abortRef.current?.abort();
  }, [fetch]);

  return { dashboards, loading, error, refetch: fetch };
}
