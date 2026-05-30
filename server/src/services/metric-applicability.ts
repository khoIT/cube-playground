/**
 * Per-game metric applicability.
 *
 * A metric can be marked N/A for a game (e.g. `cpi` needs marketing cubes a
 * given game lacks). N/A is a property of the metric — it lives in the registry
 * YAML (`meta.applicability`), NOT in any workspace. So this filter runs the
 * SAME way for the live path, the detector path, and every workspace: an
 * excluded ref never gets grouped or persisted under any scope.
 *
 * `meta.applicability` is append-only history (mirrors `trust_history`); the
 * latest entry per game wins. A metric with no entry for a game is applicable.
 *
 * Pure: no I/O.
 */

import type { BusinessMetric } from '../types/business-metric.js';
import type { UnresolvedRef } from './metric-ref-validator.js';

/**
 * Is `metric` applicable for `game`? Latest `meta.applicability` entry for the
 * game wins; missing entry defaults to applicable (true).
 */
export function applicableForGame(metric: BusinessMetric, game: string): boolean {
  const entries = metric.meta?.applicability;
  if (!entries || entries.length === 0) return true;
  let latest: { at: string; applicable: boolean } | null = null;
  for (const e of entries) {
    if (e.game !== game) continue;
    if (!latest || e.at >= latest.at) latest = { at: e.at, applicable: e.applicable };
  }
  return latest ? latest.applicable : true;
}

/**
 * Drop unresolved refs whose metric is marked N/A for `game`. Applied BEFORE
 * grouping/persisting on every path so N/A exclusion is consistent across
 * workspaces and sources.
 */
export function filterApplicable(
  refs: UnresolvedRef[],
  metricsById: Map<string, BusinessMetric>,
  game: string,
): UnresolvedRef[] {
  return refs.filter((r) => {
    const metric = metricsById.get(r.metricId);
    // Unknown metric id → keep the ref (don't silently swallow drift).
    if (!metric) return true;
    return applicableForGame(metric, game);
  });
}
