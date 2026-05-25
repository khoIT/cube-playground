/**
 * useLiveKpis — fetches KPI data for the Live KPI hero strip.
 *
 * Responsibilities:
 *   - Parallel Cube loads for all 5 KPIs (measures + 14-day sparkline).
 *   - ARPDAU derived client-side: two queries, merged by date, numerator/denominator.
 *   - Gap detection via meta: if active_daily cube absent, DAU/MAU/ARPDAU → unavailable.
 *   - sessionStorage cache keyed `liveops:kpi:${gameId}` (5 min TTL).
 *   - setInterval refresh every 45s; paused when document.hidden.
 *   - Abort on unmount or gameId change.
 *   - Token-game guard: skips fetchAll when the active Cube token was minted
 *     for a different game (avoids writing stale-game data into the cache).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppContext } from '../../hooks';
import { useSecurityContext } from '../../hooks/security-context';
import { useCubejsApi } from '../../hooks/cubejs-api';
import { useCubeTokenBootstrap } from '../../hooks/use-cube-token-bootstrap';
import { KPI_CONFIG } from './kpi-config';
import { readCache, writeCache } from './kpi-cache';
import { fetchKpi } from './kpi-fetch';
import type { CubeApiLike } from './kpi-fetch';
import { hasActiveDailyCube } from './kpi-meta';
import type { CubeMetaLike } from './use-live-kpis-types';
import { useCubeHasGameDim } from './use-cube-has-game-dim';
import type { KpiTileData, UseLiveKpisResult } from './use-live-kpis-types';

// Re-export types so importers only need this one module.
export type { KpiTileData, UseLiveKpisResult };

const REFRESH_INTERVAL_MS = 45_000;

export function useLiveKpis(gameId: string): UseLiveKpisResult {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);

  // C2: tokenGame tracks which game the current Cube JWT was minted for.
  // fetchAll is skipped when tokenGame !== gameId to prevent writing
  // stale-game data into the gameId-keyed cache during a token swap.
  const { tokenGame } = useCubeTokenBootstrap();

  // C1: meta-driven predicate — returns true only if a cube actually lists
  // a `.gameId` dimension in /meta. Today all cubes return false (JWT scoping
  // handles game routing), so applyGameFilter is a no-op. Picks up schema
  // changes automatically without any code change here.
  const cubeHasGameDim = useCubeHasGameDim(cubejsApi);

  const [tiles, setTiles] = useState<KpiTileData[]>(() => {
    const cached = readCache(gameId);
    return cached?.tiles ?? [];
  });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Stable ref to avoid stale closure in setInterval
  const gameIdRef = useRef(gameId);
  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);

  const fetchAll = useCallback(async (signal: AbortSignal) => {
    if (!cubejsApi) return;

    // C2: Guard — token has not yet been applied for the requested game.
    // The effect will re-run once tokenGame catches up (tokenGame is reactive).
    if (tokenGame !== gameIdRef.current) return;

    // Snapshot gameId at the top of this invocation to keep it consistent
    // across all awaits (gameIdRef.current could advance between awaits).
    const localGameId = gameIdRef.current;

    const activeDailyAvailable = await hasActiveDailyCube(
      cubejsApi as unknown as CubeMetaLike,
    );
    if (signal.aborted) return;

    const results = await Promise.all(
      KPI_CONFIG.map((kpi) =>
        fetchKpi(
          cubejsApi as unknown as CubeApiLike,
          kpi,
          localGameId,
          activeDailyAvailable,
          cubeHasGameDim,
        ),
      ),
    );
    if (signal.aborted) return;

    // Confirm gameId hasn't changed while we were awaiting.
    if (localGameId !== gameIdRef.current) return;

    writeCache(localGameId, results);
    setTiles(results);
    setLastRefresh(new Date());
    setLoading(false);
  }, [cubejsApi, tokenGame, cubeHasGameDim]);

  useEffect(() => {
    // Reset to cached values for new gameId immediately (no cross-game flicker)
    const cached = readCache(gameId);
    if (cached) {
      setTiles(cached.tiles);
      setLoading(false);
    } else {
      setTiles([]);
      setLoading(true);
    }

    const controller = new AbortController();

    fetchAll(controller.signal);

    const interval = setInterval(() => {
      if (!document.hidden) fetchAll(controller.signal);
    }, REFRESH_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) fetchAll(controller.signal);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [gameId, fetchAll]);

  return { tiles, loading, lastRefresh };
}
