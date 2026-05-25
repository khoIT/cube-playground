/**
 * Typed client for /api/liveops endpoints — the cache-backed surface added
 * in the liveops-polish-and-caching phase 2.
 *
 * Response contract:
 *   - 200 → cache hit, payload + fetched_at + expires_at.
 *   - 202 → cache warming or schema mismatch; caller retries with backoff.
 *   - 4xx/5xx → throws SegmentApiError via apiFetch.
 */

import { SegmentApiError } from './api-client';

export type LiveopsCacheStatus = 'fresh' | 'refreshing' | 'broken';

export interface CachedView<T> {
  payload: T;
  fetched_at: string;
  expires_at: string;
  status: LiveopsCacheStatus;
  error_msg: string | null;
}

export interface KpiStripTilePayload {
  id: string;
  label: string;
  latest: number | null;
  delta: number | null;
  sparkline: number[];
  format?: 'number' | 'currency' | 'percent';
  deltaWindow: '1d' | '7d';
  invertDelta?: boolean;
  unavailable: boolean;
  unavailableReason?: string;
  errorMsg?: string;
}

export interface KpiStripPayload {
  game: string;
  tiles: KpiStripTilePayload[];
}

export interface CohortRowPayload {
  installDate: string;
  size: number;
  d1: number;
  d3: number;
  d7: number;
  d14: number;
  d30: number;
  d1Pct: number;
  d3Pct: number;
  d7Pct: number;
  d14Pct: number;
  d30Pct: number;
  matureMask: [boolean, boolean, boolean, boolean, boolean];
}

export interface CohortGridPayload {
  game: string;
  windowDays: number;
  dataPath: 'server' | 'client' | 'unavailable';
  rows: CohortRowPayload[];
}

export interface FunnelStepPayload {
  name: string;
  count: number;
  dropFromPrev: number;
  dropPct: number;
}

export interface FunnelResultPayload {
  game: string;
  funnelDefHash: string;
  steps: FunnelStepPayload[];
  badge: 'ordered';
}

export interface FunnelDefInput {
  cubeName: string;
  orderedEvents: string[];
  windowMs?: number;
  uidFilter?: string[];
}

export type LiveopsCacheResource = 'kpi_strip' | 'cohort_grid' | 'funnel_result';

export interface WarmingResponse {
  status: 'warming' | 'meta_version_mismatch' | 'broken';
  message?: string;
  error_msg?: string | null;
  funnel_def_hash?: string;
}

export type LiveopsResponse<T> = CachedView<T> | WarmingResponse;

export function isWarming<T>(r: LiveopsResponse<T>): r is WarmingResponse {
  const hasFetchedAt = typeof (r as { fetched_at?: unknown }).fetched_at === 'string';
  return !hasFetchedAt;
}

// 202 responses are non-error per HTTP, but apiFetch treats !ok. Use a thin
// custom fetch for these so the warming payload propagates.
async function getJson<T>(path: string, query?: Record<string, string | number>): Promise<LiveopsResponse<T>> {
  const usp = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) usp.set(k, String(v));
  }
  const url = usp.toString() ? `${path}?${usp.toString()}` : path;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = (await res.json()) as LiveopsResponse<T>;
  if (res.status === 200 || res.status === 202) return body;
  throw new SegmentApiError(
    (body as { error?: { code?: string } }).error?.code ?? 'HTTP_ERROR',
    res.statusText,
    res.status,
    body,
  );
}

async function postJson<T>(path: string, body: unknown): Promise<LiveopsResponse<T>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as LiveopsResponse<T>;
  if (res.status === 200 || res.status === 202) return data;
  throw new SegmentApiError(
    (data as { error?: { code?: string } }).error?.code ?? 'HTTP_ERROR',
    res.statusText,
    res.status,
    data,
  );
}

export const liveopsClient = {
  kpiStrip(game: string): Promise<LiveopsResponse<KpiStripPayload>> {
    return getJson<KpiStripPayload>('/api/liveops/kpi-strip', { game });
  },

  cohortGrid(game: string, windowDays: number): Promise<LiveopsResponse<CohortGridPayload>> {
    return getJson<CohortGridPayload>('/api/liveops/cohort', { game, window: windowDays });
  },

  funnel(game: string, funnelDef: FunnelDefInput): Promise<LiveopsResponse<FunnelResultPayload>> {
    return postJson<FunnelResultPayload>('/api/liveops/funnel', { game, funnelDef });
  },

  forceRefresh(resource: LiveopsCacheResource, cacheKey: string): Promise<LiveopsResponse<unknown>> {
    return postJson<unknown>('/api/liveops/refresh', { resource, cacheKey });
  },

  isWarming,
};
