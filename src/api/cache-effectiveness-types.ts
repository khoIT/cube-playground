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

/** Raw BE stale-ratio counts (emitted by older BE before scalar conversion). */
export interface StaleRatioCounts {
  stale: number;   // rows with outdated cube_meta_hash
  typed: number;   // all rows with a cube_meta_hash (IS NOT NULL)
  legacy: number;  // rows with no cube_meta_hash (IS NULL)
}

export interface CacheEffectivenessResponse {
  summary: CacheEffectivenessSummary;
  sparkline: CacheSparklineDay[];
  topQueries: TopQueryRow[];
  /**
   * Fraction [0,1] of cached entries using stale cube schema (outdated hash).
   * BE now emits this as a scalar number. Accepts legacy object shape for
   * backward compat — use deriveStaleRatios() to normalize.
   */
  staleRatio: number | StaleRatioCounts;
  /** Fraction [0,1] of cached entries using the legacy cache format (no hash). */
  legacyRatio?: number;
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

/**
 * Normalize staleRatio/legacyRatio from a BE response to [0,1] fractions.
 *
 * BE now emits two scalars (staleRatio: number, legacyRatio: number).
 * When the raw payload is the legacy object shape { stale, typed, legacy },
 * we compute the fractions here so components always work with plain numbers.
 */
export function deriveStaleRatios(raw: CacheEffectivenessResponse): {
  staleRatio: number;
  legacyRatio: number;
} {
  const sr = raw.staleRatio;
  if (typeof sr === 'object' && sr !== null) {
    // BE object shape: derive scalars from raw counts
    const denom = sr.typed + sr.legacy;
    return {
      staleRatio: denom > 0 ? sr.stale / denom : 0,
      legacyRatio: denom > 0 ? sr.legacy / denom : 0,
    };
  }
  return {
    staleRatio: typeof sr === 'number' ? sr : 0,
    legacyRatio: raw.legacyRatio ?? 0,
  };
}
