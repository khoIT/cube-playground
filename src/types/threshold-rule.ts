/**
 * Client-side mirror of server/src/care/threshold-rule.ts.
 * Keep in sync with the server type when the discriminated union changes.
 *
 * ThresholdRule kinds:
 *   abs        — member compared to fixed value (e.g. ltv >= 50_000_000)
 *   tierStep   — member crosses cumulative VIP tier bands
 *   event      — member event falls within a relative time window
 *   percentile — member >= p-th percentile of a live cohort (needs calibration)
 *   ratio      — recent vs baseline self-comparison (per-member trigger, not a cohort filter)
 */

export interface AbsRule {
  kind: 'abs';
  member: string;
  op: 'gt' | 'lt' | 'gte' | 'lte' | 'equals';
  value: number;
  valueType?: 'string' | 'number' | 'time' | 'boolean';
}

export interface TierBand {
  label: string;
  min: number;
}

export interface TierStepRule {
  kind: 'tierStep';
  member: string;
  bands: TierBand[];
}

export interface EventRule {
  kind: 'event';
  member: string;
  /** Relative window string, e.g. "last 24 hours", "last 7 days". */
  window: string;
}

export interface PercentileRule {
  kind: 'percentile';
  of: string;
  p: number;
  gate?: string;
}

export interface RatioRule {
  kind: 'ratio';
  member: string;
  vs: string;
  value: number;
  op: 'gt' | 'lt' | 'gte' | 'lte';
}

export type ThresholdRule =
  | AbsRule
  | TierStepRule
  | EventRule
  | PercentileRule
  | RatioRule;
