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

export interface CacheEffectivenessResponse {
  summary: CacheEffectivenessSummary;
  sparkline: CacheSparklineDay[];
  topQueries: TopQueryRow[];
  /** Fraction [0,1] of cached entries using stale cube schema. */
  staleRatio: number | Record<string, number>;
  /** Fraction [0,1] of cached entries using the legacy cache format. */
  legacyRatio: number;
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

/** Resolved stale ratio — converts object form to a single number. */
export function resolveStaleRatio(raw: number | Record<string, number>): number {
  if (typeof raw === 'number') return raw;
  const vals = Object.values(raw);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
