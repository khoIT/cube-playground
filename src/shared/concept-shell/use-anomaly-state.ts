/**
 * useAnomalyState — fetches `/api/anomaly-state?game=<active>` once per
 * active game and caches per-game. Frontend consumers pick the metric_id
 * they need; missing key = no anomaly. The hook degrades to empty state if
 * the endpoint is unreachable so we never block a render.
 */

import { useEffect, useState } from 'react';

import { useActiveGameId } from '../../components/Header/use-game-context';
import type { BusinessMetricAnomaly } from '../../pages/Catalog/metrics-tab/business-metric-types';

type StatesByGame = Record<string, Record<string, BusinessMetricAnomaly>>;

const cache: StatesByGame = {};
const inflight = new Map<string, Promise<Record<string, BusinessMetricAnomaly>>>();
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

async function fetchFor(game: string): Promise<Record<string, BusinessMetricAnomaly>> {
  const existing = inflight.get(game);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const resp = await fetch(`/api/anomaly-state?game=${encodeURIComponent(game)}`);
      if (!resp.ok) return {} as Record<string, BusinessMetricAnomaly>;
      const json = (await resp.json()) as {
        states?: Record<string, BusinessMetricAnomaly>;
      };
      return json.states ?? {};
    } catch {
      return {} as Record<string, BusinessMetricAnomaly>;
    } finally {
      inflight.delete(game);
    }
  })();
  inflight.set(game, promise);
  const states = await promise;
  cache[game] = states;
  notify();
  return states;
}

export interface UseAnomalyStateResult {
  states: Record<string, BusinessMetricAnomaly>;
  loading: boolean;
}

export function useAnomalyState(): UseAnomalyStateResult {
  const game = useActiveGameId();
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (cache[game]) return undefined;
    let cancelled = false;
    fetchFor(game).then(() => {
      if (!cancelled) setVersion((v) => v + 1);
    });
    const sub = () => setVersion((v) => v + 1);
    subscribers.add(sub);
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, [game]);

  return {
    states: cache[game] ?? {},
    loading: !cache[game],
  };
}

/** Test-only — drops in-memory cache + inflight promises. */
export function __resetAnomalyStateCache(): void {
  for (const k of Object.keys(cache)) delete cache[k];
  inflight.clear();
}
