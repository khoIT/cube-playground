/**
 * useAnomalies — single shared hook for all 4 anomaly surfaces.
 *
 * Polls GET /api/anomalies?game=<id>&status=open every 60s.
 * Module-level cache keyed by gameId ensures only ONE network request
 * per poll cycle regardless of how many components are mounted.
 * Optimistic ack + snooze with rollback on API error.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export type AnomalySeverity = 'low' | 'med' | 'high';
export type AnomalyStatus = 'open' | 'ack' | 'snoozed';

export interface AnomalyRow {
  id: number;
  game: string;
  metric: string;
  severity: AnomalySeverity;
  baseline: number;
  observed: number;
  ts: string;
  status: AnomalyStatus;
  snooze_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface UseAnomaliesResult {
  anomalies: AnomalyRow[];
  loading: boolean;
  error: string | null;
  ack: (id: number) => Promise<void>;
  snooze: (id: number, until: string) => Promise<void>;
}

// ── Module-level cache (single source of truth for all mounted surfaces) ────

interface CacheEntry {
  anomalies: AnomalyRow[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AnomalyRow[]>>();
const subscribers = new Map<string, Set<() => void>>();

const POLL_INTERVAL_MS = 60_000;

function notifySubscribers(gameId: string): void {
  subscribers.get(gameId)?.forEach((fn) => fn());
}

async function fetchAnomalies(gameId: string): Promise<AnomalyRow[]> {
  const existing = inflight.get(gameId);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(
      `/api/anomalies?game=${encodeURIComponent(gameId)}&status=open`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { anomalies: AnomalyRow[] };
    return json.anomalies ?? [];
  })();

  inflight.set(gameId, promise);
  try {
    const rows = await promise;
    cache.set(gameId, { anomalies: rows, fetchedAt: Date.now() });
    notifySubscribers(gameId);
    return rows;
  } finally {
    inflight.delete(gameId);
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAnomalies(gameId: string): UseAnomaliesResult {
  const cached = cache.get(gameId);
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>(cached?.anomalies ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  // Keep stable ref so interval callbacks don't capture stale gameId
  const gameIdRef = useRef(gameId);
  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);

  // Sync local state when cache is updated by another mounted surface
  const syncFromCache = useCallback(() => {
    const entry = cache.get(gameIdRef.current);
    if (entry) {
      setAnomalies(entry.anomalies);
      setLoading(false);
    }
  }, []);

  const doFetch = useCallback(async (signal?: AbortSignal) => {
    try {
      const rows = await fetchAnomalies(gameIdRef.current);
      if (signal?.aborted) return;
      setAnomalies(rows);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (signal?.aborted) return;
      setError((err as Error).message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Reset when gameId changes
    const entry = cache.get(gameId);
    setAnomalies(entry?.anomalies ?? []);
    setLoading(!entry);
    setError(null);

    const controller = new AbortController();

    // Register subscriber so other surfaces' fetches update this one too
    if (!subscribers.has(gameId)) subscribers.set(gameId, new Set());
    subscribers.get(gameId)!.add(syncFromCache);

    doFetch(controller.signal);

    const interval = setInterval(() => {
      if (!document.hidden) doFetch(controller.signal);
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) doFetch(controller.signal);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      subscribers.get(gameId)?.delete(syncFromCache);
    };
  }, [gameId, doFetch, syncFromCache]);

  // ── Optimistic ack ────────────────────────────────────────────────────────

  const ack = useCallback(async (id: number) => {
    const prev = anomalies;
    const next = anomalies.filter((a) => a.id !== id);
    setAnomalies(next);
    // Optimistically update cache
    const entry = cache.get(gameId);
    if (entry) cache.set(gameId, { ...entry, anomalies: next });
    notifySubscribers(gameId);

    try {
      const res = await fetch(`/api/anomalies/${id}/ack`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Rollback
      setAnomalies(prev);
      if (entry) cache.set(gameId, { ...entry, anomalies: prev });
      notifySubscribers(gameId);
      throw err;
    }
  }, [anomalies, gameId]);

  // ── Optimistic snooze ─────────────────────────────────────────────────────

  const snooze = useCallback(async (id: number, until: string) => {
    const prev = anomalies;
    const next = anomalies.filter((a) => a.id !== id);
    setAnomalies(next);
    const entry = cache.get(gameId);
    if (entry) cache.set(gameId, { ...entry, anomalies: next });
    notifySubscribers(gameId);

    try {
      const res = await fetch(`/api/anomalies/${id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Rollback
      setAnomalies(prev);
      if (entry) cache.set(gameId, { ...entry, anomalies: prev });
      notifySubscribers(gameId);
      throw err;
    }
  }, [anomalies, gameId]);

  return { anomalies, loading, error, ack, snooze };
}

/** Test-only reset. */
export function __resetAnomaliesCache(): void {
  cache.clear();
  inflight.clear();
  subscribers.clear();
}
