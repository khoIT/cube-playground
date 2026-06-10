/**
 * Pure derivation: apply filter rail + search + per-game availability to the
 * registry. No fetching, no side-effects — re-renderable safely on every
 * filter / game change.
 */

import type {
  BusinessMetric,
  BusinessMetricDomain,
  BusinessMetricTrust,
} from './business-metric-types';
import { isAvailableForGame, isColdForGame } from './business-metric-types';

export interface MetricFilters {
  domains: Set<BusinessMetricDomain>;
  trusts: Set<BusinessMetricTrust>;
  owners: Set<string>;
  parameterisedOnly: boolean;
  showDeprecated: boolean;
  hideUnavailable: boolean;
}

export function emptyFilters(): MetricFilters {
  return {
    domains: new Set(),
    trusts: new Set(),
    owners: new Set(),
    parameterisedOnly: false,
    showDeprecated: false,
    hideUnavailable: true,
  };
}

export interface FilteredMetric {
  metric: BusinessMetric;
  available: boolean;
  missingCubes: string[];
  /** True when the metric is available but has no pre-aggregation for this game. */
  cold: boolean;
  /** True when the metric is explicitly marked not applicable for this game. */
  blockedByApplicability: boolean;
}

export interface FilteredMetricsResult {
  visible: FilteredMetric[];
  totalCount: number;
  availableCount: number;
  hiddenByGame: number;
}

function matchesQuery(metric: BusinessMetric, q: string): boolean {
  if (!q) return true;
  const hay =
    metric.id +
    ' ' +
    metric.label +
    ' ' +
    metric.description +
    ' ' +
    (metric.synonyms?.join(' ') ?? '');
  return hay.toLowerCase().includes(q);
}

export function useFilteredMetrics(
  metrics: BusinessMetric[],
  filters: MetricFilters,
  query: string,
  availableCubeNames: ReadonlySet<string>,
  gameId?: string,
): FilteredMetricsResult {
  const q = query.trim().toLowerCase();

  // 1. Compute per-game availability for ALL metrics (used for the "X of Y" chip).
  const annotated: FilteredMetric[] = metrics.map((metric) => {
    const compat = isAvailableForGame(metric, availableCubeNames, gameId);
    const cold = compat.available && !!gameId && isColdForGame(metric, gameId);
    return {
      metric,
      available: compat.available,
      missingCubes: compat.missing,
      cold,
      blockedByApplicability: compat.blockedByApplicability,
    };
  });

  const availableCount = annotated.filter((m) => m.available).length;

  // 2. Apply filters.
  const visible = annotated.filter(({ metric, available }) => {
    if (!filters.showDeprecated && metric.trust === 'deprecated') return false;
    if (filters.hideUnavailable && !available) return false;
    if (filters.parameterisedOnly && !metric.parameter) return false;
    if (filters.domains.size && !filters.domains.has(metric.domain)) return false;
    if (filters.trusts.size && !filters.trusts.has(metric.trust)) return false;
    if (filters.owners.size && !filters.owners.has(metric.owner)) return false;
    if (!matchesQuery(metric, q)) return false;
    return true;
  });

  const hiddenByGame = filters.hideUnavailable
    ? annotated.filter((m) => !m.available).length
    : 0;

  return {
    visible,
    totalCount: metrics.length,
    availableCount,
    hiddenByGame,
  };
}
