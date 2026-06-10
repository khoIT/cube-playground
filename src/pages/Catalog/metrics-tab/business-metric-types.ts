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

/** Per-game applicability entry — mirrors server MetricApplicabilityEntrySchema. */
export interface MetricApplicabilityEntry {
  game: string;
  applicable: boolean;
  at: string;
  actor?: string;
  note?: string;
}

/** Per-game serving latency — mirrors server MetricServingEntrySchema. */
export interface MetricServingEntry {
  game: string;
  latency: 'fast' | 'cold';
  at: string;
  note?: string;
}

export interface BusinessMetricMeta {
  /** Primary game id used to validate refs when promoting to certified. */
  game_id?: string;
  /** Append-only audit trail of trust transitions. */
  trust_history?: TrustHistoryEntry[];
  /** Per-game applicability history; latest entry per game wins. */
  applicability?: MetricApplicabilityEntry[];
  /** Per-game serving latency. Absence of an entry means fast (default). */
  serving?: MetricServingEntry[];
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
 * Compute per-game availability for a metric.
 *
 * A metric is "available" iff:
 *   1. Its `meta.applicability` latest entry for the game is not `applicable:false`.
 *   2. Every cube in `game_compatibility.required_cubes` exists in the game's /meta.
 *
 * When `game_compatibility` is absent and no applicability block exists, the
 * metric is treated as universally available.
 *
 * `gameId` is optional for backwards-compat callers that don't pass it; when
 * absent, only the cube-name check runs (no applicability check).
 */
export function isAvailableForGame(
  metric: BusinessMetric,
  availableCubeNames: ReadonlySet<string>,
  gameId?: string,
): { available: boolean; missing: string[]; blockedByApplicability: boolean } {
  // Applicability check: latest entry for this game wins; missing = applicable.
  let blockedByApplicability = false;
  if (gameId) {
    const entries = metric.meta?.applicability?.filter((e) => e.game === gameId) ?? [];
    if (entries.length > 0) {
      const latest = entries.reduce((best, e) => (e.at > best.at ? e : best));
      blockedByApplicability = !latest.applicable;
    }
  }

  const required = metric.game_compatibility?.required_cubes ?? [];
  const missing = required.filter((c) => !availableCubeNames.has(c));
  const available = !blockedByApplicability && missing.length === 0;
  return { available, missing, blockedByApplicability };
}

/**
 * Returns true when the metric's `meta.serving` latest entry for the given
 * game has `latency: 'cold'`. Absence of any entry means fast (default).
 */
export function isColdForGame(metric: BusinessMetric, gameId: string): boolean {
  const entries = metric.meta?.serving?.filter((e) => e.game === gameId) ?? [];
  if (entries.length === 0) return false;
  const latest = entries.reduce((best, e) => (e.at > best.at ? e : best));
  return latest.latency === 'cold';
}
