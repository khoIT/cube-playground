/**
 * Cache effectiveness aggregator.
 *
 * Orchestrates 5 SQL helpers from cache-effectiveness-queries.ts into a single
 * result shape consumed by the debug-cache-effectiveness Fastify plugin.
 *
 * PRIVACY INVARIANT: all queries join through chat_sessions.owner_id — no
 * response_cache row is reachable without the originating session owner match.
 * Verified by the "owner isolation" unit test.
 *
 * $ saved formula (LOCKED): Σ cost_usd × (hit_count - 1) per row where hit_count > 0.
 * staleRatio uses newest-row-hash-per-game as "current" hash proxy (cubeToken
 * is unavailable in the debug endpoint context).
 */

import type Database from 'better-sqlite3';
import {
  queryHitRateAndLatency,
  querySavingsTotals,
  querySparklineByDay,
  queryTopQueriesByHit,
  queryStaleRatio,
} from './cache-effectiveness-queries.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LatencyWin {
  avgHitMs: number;
  avgMissMs: number;
  speedupX: number;
}

export interface SparklineDay {
  day: string;      // YYYY-MM-DD
  hits: number;
  misses: number;
}

export interface TopQuery {
  queryKey: string;
  snippet: string;           // first 80 chars of user_text_normalized
  skill: string;
  model: string;
  hitCount: number;
  lastHitAt: number | null;
  dollarsSaved: number;      // cost_usd × (hit_count - 1)
  originalTurnId: string;
  originalSessionId: string;
}

export interface StaleRatio {
  stale: number;   // cube_meta_hash IS NOT NULL AND != currentHash for that game
  typed: number;   // cube_meta_hash IS NOT NULL
  legacy: number;  // cube_meta_hash IS NULL
}

export interface CacheEffectivenessResult {
  summary: {
    hitRate: number;
    dollarsSaved: number;
    tokensSaved: number;
    latencyWinMs: LatencyWin;
  };
  sparkline: SparklineDay[];
  topQueries: TopQuery[];
  staleRatio: StaleRatio;
  currentMetaHash: string | null;
  computedAt: string;
}

export interface CacheEffectivenessParams {
  ownerId: string;
  gameId?: string;
  days: number;
  topN: number;
  q?: string;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Compute all cache-effectiveness metrics for the given owner+game scope.
 * days and topN are clamped defensively here as well as at the plugin layer.
 */
export function computeCacheEffectiveness(
  db: Database.Database,
  params: CacheEffectivenessParams,
): CacheEffectivenessResult {
  const days = Math.max(1, Math.min(90, params.days));
  const topN = Math.max(1, Math.min(100, params.topN));
  const sinceMs = Date.now() - days * 24 * 3_600_000;

  const { hitRate, latencyWin } = queryHitRateAndLatency(db, {
    ownerId: params.ownerId, gameId: params.gameId, sinceMs,
  });
  const { dollarsSaved, tokensSaved } = querySavingsTotals(db, {
    ownerId: params.ownerId, gameId: params.gameId,
  });
  const sparkline = querySparklineByDay(db, {
    ownerId: params.ownerId, gameId: params.gameId, sinceMs, days,
  });
  const topQueries = queryTopQueriesByHit(db, {
    ownerId: params.ownerId, gameId: params.gameId, topN, q: params.q,
  });
  const { staleRatio, currentMetaHash } = queryStaleRatio(db, {
    ownerId: params.ownerId, gameId: params.gameId,
  });

  return {
    summary: { hitRate, dollarsSaved, tokensSaved, latencyWinMs: latencyWin },
    sparkline,
    topQueries,
    staleRatio,
    currentMetaHash,
    computedAt: new Date().toISOString(),
  };
}
