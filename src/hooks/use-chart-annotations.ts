/**
 * Hook for fetching chart annotations for a game + optional date range.
 * Global (game IS NULL) annotations are merged in by the server automatically.
 * Refetch is exposed so callers can refresh after create/update/delete.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchAnnotations, type ChartAnnotation, type ListAnnotationsParams } from '../api/chart-annotations';

interface UseChartAnnotationsResult {
  annotations: ChartAnnotation[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useChartAnnotations(params: ListAnnotationsParams): UseChartAnnotationsResult {
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Increment to trigger re-fetch without changing params reference.
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!params.game) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAnnotations(params)
      .then((rows) => {
        if (!cancelled) setAnnotations(rows);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message ?? 'Failed to load annotations');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.game, params.from, params.to, tick]);

  return { annotations, loading, error, refetch };
}
