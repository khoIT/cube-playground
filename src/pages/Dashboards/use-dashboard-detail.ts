/**
 * SWR-style hook: fetches a single dashboard (with tiles) by slug + game.
 * Re-fetches when slug or gameId changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dashboardsClient,
  type DashboardWithTiles,
} from '../../api/dashboards-client';

interface UseDashboardDetailResult {
  dashboard: DashboardWithTiles | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDashboardDetail(
  slug: string,
  gameId: string,
): UseDashboardDetailResult {
  const [dashboard, setDashboard] = useState<DashboardWithTiles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetch = useCallback(() => {
    if (!slug || !gameId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    dashboardsClient
      .get(slug, gameId)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setDashboard(data);
      })
      .catch((err: Error) => {
        if (ctrl.signal.aborted) return;
        setError(err.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
  }, [slug, gameId]);

  useEffect(() => {
    fetch();
    return () => abortRef.current?.abort();
  }, [fetch]);

  return { dashboard, loading, error, refetch: fetch };
}
