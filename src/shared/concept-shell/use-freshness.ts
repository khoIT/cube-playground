/**
 * useFreshness — derives a FreshnessState for a cube from /meta. v1 falls
 * back to `'unknown'` because Cube's stock /meta does not surface
 * `refresh_key.lastTimestamp`; surfacing it would require either:
 *   a) cube-dev backend extension, or
 *   b) a sidecar /meta proxy that injects it from pre-aggregation logs.
 *
 * When that work lands, populate `cube.refresh_key.lastTimestamp` on the
 * CatalogCube and this hook starts returning real buckets without any
 * call-site changes.
 */

import { useMemo } from 'react';

import { useCatalogMeta } from '../../pages/Catalog/use-catalog-meta';
import type { FreshnessState } from './freshness-chip';

const FRESH_THRESHOLD_MS = 60 * 60 * 1000; // 1h
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

type RefreshAware = {
  refresh_key?: { lastTimestamp?: string | number };
};

export function bucketByAge(ageMs: number): FreshnessState {
  if (ageMs <= FRESH_THRESHOLD_MS) return 'fresh';
  if (ageMs <= STALE_THRESHOLD_MS) return 'fresh';
  return 'stale';
}

export interface UseFreshnessResult {
  state: FreshnessState;
  ageMs: number | null;
}

export function useFreshness(cubeName: string | null): UseFreshnessResult {
  const { cubes } = useCatalogMeta();
  return useMemo(() => {
    if (!cubeName) return { state: 'unknown', ageMs: null };
    const cube = cubes.find((c) => c.name === cubeName) as
      | (typeof cubes)[number] & RefreshAware
      | undefined;
    const ts = cube?.refresh_key?.lastTimestamp;
    if (ts === undefined) return { state: 'unknown', ageMs: null };
    const parsed = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(parsed)) return { state: 'unknown', ageMs: null };
    const ageMs = Date.now() - parsed;
    return { state: bucketByAge(ageMs), ageMs };
  }, [cubes, cubeName]);
}
