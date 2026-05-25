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
  queryKvCacheByKind,
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

/** Per-kind row count + hit totals from the unified kv_cache table. */
export interface KvCacheKindStat {
  kind: string;
  entries: number;
  totalHits: number;
  lastHitAt: number | null;
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
  /** Fraction [0,1] of cache rows with an outdated cube_meta_hash. */
  staleRatio: number;
  /** Fraction [0,1] of cache rows with no cube_meta_hash (legacy format). */
  legacyRatio: number;
  currentMetaHash: string | null;
  /**
   * Non-response_cache caches (cube /load rows, turn-detail audit) grouped
   * by kind. Empty when no kv_cache rows exist yet. Each entry is a tiny
   * stat strip — not the full hit-rate / saved-dollars panel since these
   * surfaces don't have miss latency or LLM cost to compare against.
   */
  byKind: KvCacheKindStat[];
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
  const { staleRatio: rawStale, currentMetaHash } = queryStaleRatio(db, {
    ownerId: params.ownerId, gameId: params.gameId,
  });
  const byKind = queryKvCacheByKind(db);

  // Convert raw counts to [0,1] fractions. denom = typed + legacy = all non-null + null rows.
  const denom = rawStale.typed + rawStale.legacy;
  const staleRatio = denom > 0 ? rawStale.stale / denom : 0;
  const legacyRatio = denom > 0 ? rawStale.legacy / denom : 0;

  return {
    summary: { hitRate, dollarsSaved, tokensSaved, latencyWinMs: latencyWin },
    sparkline,
    topQueries,
    staleRatio,
    legacyRatio,
    currentMetaHash,
    byKind,
    computedAt: new Date().toISOString(),
  };
}
