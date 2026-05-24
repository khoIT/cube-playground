/**
 * Frontend types for the business-metrics registry.
 *
 * Kept in lockstep with the server-side Zod schema in
 * `server/src/types/business-metric.ts`. The frontend cannot import the server
 * module (no monorepo wiring), so this file mirrors the shape by hand. When
 * the schema changes, update both sides.
 */

export type BusinessMetricDomain =
  | 'revenue'
  | 'engagement'
  | 'acquisition'
  | 'retention'
  | 'payments'
  | 'concurrency'
  | 'marketing';

export type BusinessMetricTrust =
  | 'certified'
  | 'draft'
  | 'deprecated';

export type BusinessMetricFormula =
  | { type: 'ratio'; numerator: string; denominator: string }
  | { type: 'measure'; ref: string }
  | { type: 'expression'; expression: string; inputs?: string[] };

export interface BusinessMetricParameter {
  name: string;
  label?: string;
  options: Array<string | number>;
  default?: string | number;
}

export interface BusinessMetricGameCompat {
  required_cubes: string[];
}

export type BusinessMetricAnomalyState = 'none' | 'low' | 'high' | 'trend';

export interface BusinessMetricAnomalyBreakdownRow {
  label: string;
  deltaPct: number;
}

export interface BusinessMetricAnomalyBreakdowns {
  country?: BusinessMetricAnomalyBreakdownRow[];
  channel?: BusinessMetricAnomalyBreakdownRow[];
  tier?: BusinessMetricAnomalyBreakdownRow[];
}

export interface BusinessMetricAnomaly {
  state: BusinessMetricAnomalyState;
  deltaPct?: number;
  period?: string;
  breakdowns?: BusinessMetricAnomalyBreakdowns;
}

export interface TrustHistoryEntry {
  trust: BusinessMetricTrust;
  /** ISO 8601 timestamp recorded when the trust was changed. */
  at: string;
  actor?: string;
  note?: string;
}

export interface BusinessMetricMeta {
  /** Primary game id used to validate refs when promoting to certified. */
  game_id?: string;
  /** Append-only audit trail of trust transitions. */
  trust_history?: TrustHistoryEntry[];
  [key: string]: unknown;
}

export interface BusinessMetric {
  id: string;
  label: string;
  description: string;
  synonyms?: string[];
  tier: number;
  domain: BusinessMetricDomain;
  owner: string;
  trust: BusinessMetricTrust;
  formula: BusinessMetricFormula;
  game_compatibility?: BusinessMetricGameCompat;
  parameter?: BusinessMetricParameter;
  related_concepts?: string[];
  unit?: string;
  format?: string;
  anomaly?: BusinessMetricAnomaly;
  meta?: BusinessMetricMeta;
}

/**
 * Compute per-game availability for a metric: a metric is "available" iff
 * every cube listed in `game_compatibility.required_cubes` exists in the
 * currently active game's `/meta` payload. When `game_compatibility` is
 * absent, the metric is treated as universally available.
 */
export function isAvailableForGame(
  metric: BusinessMetric,
  availableCubeNames: ReadonlySet<string>,
): { available: boolean; missing: string[] } {
  const required = metric.game_compatibility?.required_cubes ?? [];
  const missing = required.filter((c) => !availableCubeNames.has(c));
  return { available: missing.length === 0, missing };
}
