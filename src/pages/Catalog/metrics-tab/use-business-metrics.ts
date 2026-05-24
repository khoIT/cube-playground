/**
 * `useBusinessMetrics` — fetch the business-metrics registry from the Fastify
 * sidecar (`GET /api/business-metrics`) with single-flight dedupe. The first
 * call in a session triggers the fetch; subsequent renders / hook mounts
 * wait on the in-flight promise rather than re-fetching.
 *
 * When `gameId` is passed, the hook calls `/api/business-metrics?game=<id>`
 * so the server's trust resolver can downgrade metrics with broken refs to
 * `'draft'`. Cache + single-flight are keyed by gameId so switching games
 * triggers exactly one fresh fetch per game.
 */

import { useCallback, useEffect, useState } from 'react';

import type { BusinessMetric } from './business-metric-types';

type RegistryResponse = { metrics: BusinessMetric[] };

const NO_GAME = '__none__';

const cache = new Map<string, BusinessMetric[]>();
const inflight = new Map<string, Promise<BusinessMetric[]>>();
type Subscriber = (metrics: BusinessMetric[]) => void;
const subscribers = new Map<string, Set<Subscriber>>();

function keyFor(gameId: string | null | undefined): string {
  return gameId ?? NO_GAME;
}

function urlFor(key: string): string {
  return key === NO_GAME
    ? '/api/business-metrics'
    : `/api/business-metrics?game=${encodeURIComponent(key)}`;
}

function notify(key: string, metrics: BusinessMetric[]): void {
  subscribers.get(key)?.forEach((cb) => cb(metrics));
}

// 20s — generous enough to outlast a healthy /api/business-metrics call (which
// internally hits Cube /meta), but short enough that a hung cube_api surfaces
// as a real error instead of an infinite "Loading metric…".
const REGISTRY_FETCH_TIMEOUT_MS = 20_000;

async function fetchOnce(key: string): Promise<BusinessMetric[]> {
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REGISTRY_FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(urlFor(key), {
        headers: { Accept: 'application/json' },
        signal: ctl.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as RegistryResponse;
      const metrics = json.metrics ?? [];
      cache.set(key, metrics);
      notify(key, metrics);
      return metrics;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Metrics registry request timed out — Cube backend likely hung.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

interface UseBusinessMetricsResult {
  metrics: BusinessMetric[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useBusinessMetrics(
  gameId?: string | null,
): UseBusinessMetricsResult {
  const key = keyFor(gameId);
  const [metrics, setMetrics] = useState<BusinessMetric[]>(
    () => cache.get(key) ?? [],
  );
  const [loading, setLoading] = useState<boolean>(() => !cache.has(key));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const cached = cache.get(key);
    if (cached) {
      setMetrics(cached);
      setLoading(false);
    } else {
      setLoading(true);
      fetchOnce(key)
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
    }
    const sub: Subscriber = (m) => {
      if (!cancelled) setMetrics(m);
    };
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    set.add(sub);
    return () => {
      cancelled = true;
      set?.delete(sub);
    };
  }, [key]);

  const refresh = useCallback(() => {
    cache.delete(key);
    inflight.delete(key);
    setLoading(true);
    fetchOnce(key)
      .then((m) => {
        setMetrics(m);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [key]);

  return { metrics, loading, error, refresh };
}

/** Test-only: reset module state between cases. */
export function __resetBusinessMetricsCache(): void {
  cache.clear();
  inflight.clear();
  subscribers.clear();
}
