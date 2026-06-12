/**
 * Types for the /api/chat/debug/cache-effectiveness endpoint (phase 04).
 * All FE cache dashboard components import from here — single source of truth.
 */

export interface CacheEffectivenessSummary {
  hitRate: number | null;
  dollarsSaved: number;
  tokensSaved: number;
  latencyWinMs: {
    avgHitMs: number | null;
    avgMissMs: number | null;
  };
}

export interface CacheSparklineDay {
  day: string;   // ISO date string
  hits: number;
  misses: number;
}

export interface TopQueryRow {
  cacheKey: string;
  normalizedQuery: string;
  skill: string | null;
  model: string | null;
  hitCount: number;
  lastHitAt: string | null;   // ISO timestamp
  costUsd: number | null;
  originalSessionId: string | null;
  originalTurnId: string | null;
}

/**
 * Raw stale-ratio counts from BE.
 * stale  = rows where cube_meta_hash IS NOT NULL AND != newest hash for that game.
 * typed  = rows where cube_meta_hash IS NOT NULL (superset includes stale).
 * legacy = rows where cube_meta_hash IS NULL.
 */
export interface BEStaleRatioCounts {
  stale: number;
  typed: number;
  legacy: number;
}

export interface CacheEffectivenessResponse {
  summary: CacheEffectivenessSummary;
  sparkline: CacheSparklineDay[];
  topQueries: TopQueryRow[];
  /** Raw counts from BE — use deriveStaleRatios() to get [0,1] fractions. */
  staleRatio: BEStaleRatioCounts;
}

/**
 * Derive [0,1] scalar ratios from the raw BE counts.
 *
 * staleRatio  = stale / (typed + legacy)  — fraction of all rows that are stale.
 * legacyRatio = legacy / (typed + legacy) — fraction of all rows using legacy format.
 *
 * Both default to 0 when the cache is empty (denom = 0).
 */
export function deriveStaleRatios(raw: BEStaleRatioCounts): { staleRatio: number; legacyRatio: number } {
  const denom = raw.typed + raw.legacy;
  if (denom === 0) return { staleRatio: 0, legacyRatio: 0 };
  return {
    staleRatio: raw.stale / denom,
    legacyRatio: raw.legacy / denom,
  };
}

/**
 * Threshold above which the stale-cache pressure BANNER is shown (heavy signal).
 * Distinct from the inline chip in CacheDashboardHero (10% threshold).
 * Env-tunable: set VITE_STALE_CACHE_BANNER_THRESHOLD to override.
 */
export const STALE_CACHE_BANNER_THRESHOLD = parseFloat(
  (typeof import.meta !== 'undefined' && (import.meta as Record<string, unknown>).env != null
    ? ((import.meta as { env: Record<string, string> }).env.VITE_STALE_CACHE_BANNER_THRESHOLD ?? '0.25')
    : '0.25'),
);
