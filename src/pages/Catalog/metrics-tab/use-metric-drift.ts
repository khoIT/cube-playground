/**
 * useMetricDrift — fetch the `GET /api/business-metrics/drift?game=…` endpoint
 * and expose `{ resolvable, total, broken }` for the current game.
 *
 * Cached in-module per-gameId so opening the catalog and reopening doesn't
 * re-fetch within a session. `refresh()` busts the cache for the current key.
 */

import { useCallback, useEffect, useState } from 'react';

export interface MetricDriftBrokenEntry {
  id: string;
  missingRefs: string[];
}

export interface MetricDriftSnapshot {
  total: number;
  resolvable: number;
  broken: MetricDriftBrokenEntry[];
}

interface UseMetricDriftResult {
  drift: MetricDriftSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const cache = new Map<string, MetricDriftSnapshot>();
const inflight = new Map<string, Promise<MetricDriftSnapshot>>();

function fetchDrift(gameId: string): Promise<MetricDriftSnapshot> {
  const cached = cache.get(gameId);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(gameId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const res = await fetch(
        `/api/business-metrics/drift?game=${encodeURIComponent(gameId)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MetricDriftSnapshot;
      cache.set(gameId, json);
      return json;
    } finally {
      inflight.delete(gameId);
    }
  })();
  inflight.set(gameId, promise);
  return promise;
}

export function useMetricDrift(gameId: string | null | undefined): UseMetricDriftResult {
  const [drift, setDrift] = useState<MetricDriftSnapshot | null>(
    () => (gameId ? cache.get(gameId) ?? null : null),
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) {
      setDrift(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setError(null);
    setLoading(!cache.has(gameId));
    fetchDrift(gameId)
      .then((d) => {
        if (cancelled) return;
        setDrift(d);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const refresh = useCallback(() => {
    if (!gameId) return;
    cache.delete(gameId);
    inflight.delete(gameId);
    setLoading(true);
    fetchDrift(gameId)
      .then((d) => {
        setDrift(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [gameId]);

  return { drift, loading, error, refresh };
}

/** Test-only. */
export function __resetMetricDriftCache(): void {
  cache.clear();
  inflight.clear();
}
