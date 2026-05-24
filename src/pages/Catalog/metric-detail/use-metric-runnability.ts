/**
 * useMetricRunnability — derive whether a business metric's refs resolve
 * against the active game's catalog meta. Returns `{ status, missingRefs }`.
 *
 * Fail-open: while meta is loading or empty, status is `'ok'` so we never
 * block users on a transient load state. Real check fires once cubes arrive.
 */

import { useMemo } from 'react';

import { findMissingRefs, snapshotFromCubes } from '../../../lib/validate-metric-refs';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import { useCatalogMeta } from '../use-catalog-meta';

export interface MetricRunnability {
  status: 'ok' | 'broken';
  missingRefs: string[];
}

export function useMetricRunnability(metric: BusinessMetric | null): MetricRunnability {
  const { cubes, loading } = useCatalogMeta();

  return useMemo<MetricRunnability>(() => {
    if (!metric) return { status: 'ok', missingRefs: [] };
    if (loading || cubes.length === 0) return { status: 'ok', missingRefs: [] };
    const snapshot = snapshotFromCubes(cubes);
    const missing = findMissingRefs(metric, snapshot);
    return missing.length === 0
      ? { status: 'ok', missingRefs: [] }
      : { status: 'broken', missingRefs: missing };
  }, [metric, cubes, loading]);
}
