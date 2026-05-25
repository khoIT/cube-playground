/**
 * Configuration knobs for the liveops result cache.
 * Universal TTL chosen per the cook --auto session: 5min across all liveops
 * resources. Phase 6 (settings tabs) makes these per-resource overridable via
 * app_settings; until then they're read from this module.
 */

export type LiveopsCacheResource = 'kpi_strip' | 'cohort_grid' | 'funnel_result';

const UNIVERSAL_TTL_SECONDS = 300; // 5 minutes

export interface LiveopsCacheConfig {
  ttlSeconds: Record<LiveopsCacheResource, number>;
  /** Per-resource Cube /load budget per cron tick (across all games). */
  perTickBudget: number;
  /** Total cron tick interval; refresh job ticks at this cadence. */
  tickIntervalMs: number;
  /** Per-resource refresh timeout (Cube /load + Continue-wait polling). */
  perRefreshTimeoutMs: number;
  /** Funnel cache rows older than this are swept (analyst experimentation). */
  funnelRetentionDays: number;
}

const DEFAULT_CONFIG: LiveopsCacheConfig = {
  ttlSeconds: {
    kpi_strip: UNIVERSAL_TTL_SECONDS,
    cohort_grid: UNIVERSAL_TTL_SECONDS,
    funnel_result: UNIVERSAL_TTL_SECONDS,
  },
  perTickBudget: 30,
  tickIntervalMs: 60_000,
  perRefreshTimeoutMs: 60_000,
  funnelRetentionDays: 14,
};

let activeConfig: LiveopsCacheConfig = DEFAULT_CONFIG;

export function getLiveopsCacheConfig(): LiveopsCacheConfig {
  return activeConfig;
}

/** Phase 6 will swap this when app_settings PATCH changes a TTL. */
export function setLiveopsCacheConfig(patch: Partial<LiveopsCacheConfig>): void {
  activeConfig = {
    ...activeConfig,
    ...patch,
    ttlSeconds: {
      ...activeConfig.ttlSeconds,
      ...(patch.ttlSeconds ?? {}),
    },
  };
}

/** Test-only reset. */
export function __resetLiveopsCacheConfig(): void {
  activeConfig = DEFAULT_CONFIG;
}
