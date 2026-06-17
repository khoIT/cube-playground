/**
 * Per-game watched metrics for the anomaly detector.
 * Each entry names a Cube measure + its time dimension + |z| severity thresholds.
 *
 * Games without active_daily (muaw, ptg) get empty arrays — the detector
 * simply has nothing to check for them.
 */

export interface AnomalyMetricConfig {
  /** Fully-qualified Cube measure, e.g. "active_daily.dau" */
  metric: string;
  /** Fully-qualified Cube time dimension, e.g. "active_daily.log_date" */
  timeDim: string;
  threshold: {
    low: number;  // |z| >= low  → severity 'low'
    med: number;  // |z| >= med  → severity 'med'
    high: number; // |z| >= high → severity 'high'
  };
}

export type Severity = 'low' | 'med' | 'high';

/**
 * Returns the highest matching severity for a given |z|, or null if below
 * every threshold (including the low threshold — not anomalous).
 */
export function classifySeverity(
  absZ: number,
  cfg: AnomalyMetricConfig,
): Severity | null {
  if (absZ >= cfg.threshold.high) return 'high';
  if (absZ >= cfg.threshold.med) return 'med';
  if (absZ >= cfg.threshold.low) return 'low';
  return null;
}

const BASE_THRESHOLDS = { low: 2, med: 3, high: 4 } as const;

const ACTIVE_DAILY_DAU: AnomalyMetricConfig = {
  metric: 'active_daily.dau',
  timeDim: 'active_daily.log_date',
  threshold: BASE_THRESHOLDS,
};

const REVENUE: AnomalyMetricConfig = {
  metric: 'user_recharge_daily.revenue_vnd_total',
  timeDim: 'user_recharge_daily.log_date',
  threshold: BASE_THRESHOLDS,
};

// Peak concurrent users — the headline ops alert (a peak drop = incident /
// player loss, a spike = event). Only jus_vn + ptg carry a CCU sampling source
// (etl_ingame_ccu); the ccu cube buckets and sums servers into a per-time-bucket
// system series, so daily granularity yields one peak per day to z-score.
const CCU_PEAK: AnomalyMetricConfig = {
  metric: 'ccu.peak',
  timeDim: 'ccu.online_time',
  threshold: BASE_THRESHOLDS,
};

/**
 * Map of gameId → metrics to watch.
 * Extend this map when new games gain active_daily or recharge cubes.
 */
export const ANOMALY_METRICS: Record<string, AnomalyMetricConfig[]> = {
  ballistar: [ACTIVE_DAILY_DAU, REVENUE],
  cfm:       [ACTIVE_DAILY_DAU, REVENUE],
  jus:       [ACTIVE_DAILY_DAU, REVENUE, CCU_PEAK],
  pubg:      [ACTIVE_DAILY_DAU, REVENUE],
  // muaw lacks active_daily cube — no metrics to watch
  muaw: [],
  // ptg lacks active_daily cube but has a CCU sampling source (etl_ingame_ccu)
  ptg:  [CCU_PEAK],
};
