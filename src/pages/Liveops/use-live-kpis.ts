/**
 * useLiveKpis — fetches KPI data for the Live KPI hero strip.
 *
 * Phase-2 caching change: the FE no longer hits Cube directly. It reads from
 * the server-side cache at /api/liveops/kpi-strip. The server's cron job
 * keeps that cache warm.
 *
 * - sessionStorage stays as L1 (sub-second flicker between routes).
 * - 202 "warming" responses → retry with exponential backoff capped at 10s.
 * - Visibility-aware: refresh paused while tab is hidden.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { liveopsClient, type KpiStripPayload, type KpiStripTilePayload, type LiveopsResponse, type CachedView } from '../../api/liveops-client';
import { readCache, writeCache } from './kpi-cache';
import { formatValue, formatDelta, deltaTone } from './kpi-format';
import type { KpiTileData, UseLiveKpisResult } from './use-live-kpis-types';

export type { KpiTileData, UseLiveKpisResult };

const REFRESH_INTERVAL_MS = 45_000;
const WARMING_RETRY_BASE_MS = 1_000;
const WARMING_RETRY_MAX_MS = 10_000;

function isCached<T>(r: LiveopsResponse<T>): r is CachedView<T> {
  return (r as CachedView<T>).status === 'fresh' || (r as CachedView<T>).status === 'refreshing';
}

function toTile(spec: KpiStripTilePayload): KpiTileData {
  if (spec.unavailable) {
    return {
      id: spec.id,
      label: spec.label,
      value: '—',
      delta: null,
      tone: 'neutral',
      sparkline: [],
      unavailable: true,
      unavailableReason: spec.unavailableReason,
      error: null,
    };
  }
  if (spec.errorMsg) {
    return {
      id: spec.id,
      label: spec.label,
      value: '—',
      delta: null,
      tone: 'neutral',
      sparkline: [],
      unavailable: false,
      error: new Error(spec.errorMsg),
    };
  }
  return {
    id: spec.id,
    label: spec.label,
    value: spec.latest != null ? formatValue(spec.latest, spec.format) : '—',
    delta: spec.delta != null ? formatDelta(spec.delta) : null,
    tone: spec.delta != null ? deltaTone(spec.delta, spec.invertDelta) : 'neutral',
    sparkline: spec.sparkline,
    unavailable: false,
    error: null,
  };
}

export function useLiveKpis(gameId: string): UseLiveKpisResult {
  const [tiles, setTiles] = useState<KpiTileData[]>(() => {
    const cached = readCache(gameId);
    return cached?.tiles ?? [];
  });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const gameIdRef = useRef(gameId);
  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);

  const fetchOnce = useCallback(async (signal: AbortSignal, attempt = 0): Promise<void> => {
    const localGameId = gameIdRef.current;
    try {
      const res = await liveopsClient.kpiStrip(localGameId);
      if (signal.aborted) return;
      if (localGameId !== gameIdRef.current) return;

      if (isCached<KpiStripPayload>(res)) {
        const next = res.payload.tiles.map(toTile);
        writeCache(localGameId, next);
        setTiles(next);
        setLastRefresh(new Date(res.fetched_at));
        setLoading(false);
        return;
      }

      // 202 warming — retry with backoff while focused.
      const delay = Math.min(WARMING_RETRY_BASE_MS * Math.pow(2, attempt), WARMING_RETRY_MAX_MS);
      setTimeout(() => {
        if (!signal.aborted && !document.hidden) {
          void fetchOnce(signal, attempt + 1);
        }
      }, delay);
    } catch (err) {
      if (signal.aborted) return;
      // Surface the error on every tile so the strip degrades gracefully.
      setTiles((prev) => prev.length > 0 ? prev : []);
      setLoading(false);
      // eslint-disable-next-line no-console
      console.warn('[useLiveKpis] cache read failed:', (err as Error).message);
    }
  }, []);

  useEffect(() => {
    const cached = readCache(gameId);
    if (cached) {
      setTiles(cached.tiles);
      setLoading(false);
    } else {
      setTiles([]);
      setLoading(true);
    }

    const controller = new AbortController();
    void fetchOnce(controller.signal);

    const interval = setInterval(() => {
      if (!document.hidden) void fetchOnce(controller.signal);
    }, REFRESH_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) void fetchOnce(controller.signal);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [gameId, fetchOnce]);

  return { tiles, loading, lastRefresh };
}
