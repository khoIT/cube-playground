/**
 * `useBusinessMetrics` — fetch the business-metrics registry from the Fastify
 * sidecar (`GET /api/business-metrics`) with single-flight dedupe. The first
 * call in a session triggers the fetch; subsequent renders / hook mounts
 * wait on the in-flight promise rather than re-fetching.
 *
 * This mirrors the `useCatalogMeta` mutex pattern: one shared promise,
 * cached result, manual refresh via `mutate`.
 */

import { useCallback, useEffect, useState } from 'react';

import type { BusinessMetric } from './business-metric-types';

type RegistryResponse = { metrics: BusinessMetric[] };

let cache: BusinessMetric[] | null = null;
let inflight: Promise<BusinessMetric[]> | null = null;
const subscribers = new Set<(metrics: BusinessMetric[]) => void>();

async function fetchOnce(): Promise<BusinessMetric[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const resp = await fetch('/api/business-metrics', {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as RegistryResponse;
      cache = json.metrics ?? [];
      subscribers.forEach((cb) => cb(cache!));
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

interface UseBusinessMetricsResult {
  metrics: BusinessMetric[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useBusinessMetrics(): UseBusinessMetricsResult {
  const [metrics, setMetrics] = useState<BusinessMetric[]>(cache ?? []);
  const [loading, setLoading] = useState<boolean>(cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (cache !== null) {
      setMetrics(cache);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchOnce()
      .then((m) => {
        if (cancelled) return;
        setMetrics(m);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    const sub = (m: BusinessMetric[]) => {
      if (!cancelled) setMetrics(m);
    };
    subscribers.add(sub);
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, []);

  const refresh = useCallback(() => {
    cache = null;
    inflight = null;
    setLoading(true);
    fetchOnce()
      .then((m) => {
        setMetrics(m);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  return { metrics, loading, error, refresh };
}

/** Test-only: reset module state between cases. */
export function __resetBusinessMetricsCache(): void {
  cache = null;
  inflight = null;
  subscribers.clear();
}
