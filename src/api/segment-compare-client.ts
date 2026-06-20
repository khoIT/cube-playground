/**
 * Typed client for the segment-compare endpoints (overlap set-math, per-region
 * metrics, save-region). Mirrors the server contract in
 * server/src/routes/segment-compare-routes.ts. All calls go through apiFetch.
 */

import { apiFetch } from './api-client';

export type OverlapRegion = 'aOnly' | 'both' | 'bOnly';

export interface OverlapSegmentSummary {
  id: string;
  name: string;
  snapshot_ts: string | null;
  snapshot_date: string | null;
  stale: boolean;
  has_snapshot: boolean;
}

export interface OverlapResponse {
  a: OverlapSegmentSummary;
  b: OverlapSegmentSummary;
  game_id: string;
  a_size: number;
  b_size: number;
  a_only: number;
  both: number;
  b_only: number;
  jaccard: number;
}

export interface RegionMeasureStat {
  concept: string;
  label: string;
  currency: 'vnd' | 'usd' | null;
  avg: number | null;
  median: number | null;
  count: number;
}

export interface RegionMetricsResponse {
  region: OverlapRegion;
  member_count: number;
  metrics: {
    sampleSize: number;
    sampled: boolean;
    measures: RegionMeasureStat[];
  } | null;
}

export const segmentCompareClient = {
  overlap(a: string, b: string, signal?: AbortSignal): Promise<OverlapResponse> {
    return apiFetch<OverlapResponse>('/api/segments/compare', { query: { a, b }, signal });
  },

  regionMetrics(
    a: string,
    b: string,
    region: OverlapRegion,
    signal?: AbortSignal,
  ): Promise<RegionMetricsResponse> {
    return apiFetch<RegionMetricsResponse>('/api/segments/compare/region-metrics', {
      query: { a, b, region },
      signal,
    });
  },

  saveRegion(
    a: string,
    b: string,
    region: OverlapRegion,
    name: string,
  ): Promise<{ id: string; uid_count: number }> {
    return apiFetch<{ id: string; uid_count: number }>('/api/segments/compare/save-region', {
      method: 'POST',
      body: { a, b, region, name },
    });
  },
};
