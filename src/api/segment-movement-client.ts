/**
 * Typed read client for the segment movement / KPI-trend / state-distribution
 * endpoints (server: routes/segment-movement.ts). All are tokenless, bounded,
 * and serve-stale on Trino error. `granularity` triggers server-side
 * downsampling (last-in-bucket); the response carries `effectiveGranularity`
 * (the finest grain actually captured in the window) so the UI can clamp its
 * view-time toggle, plus `cadenceChanges` / `carryForward` for annotation.
 */

import { apiFetch } from './api-client';

/** View-time / capture granularity buckets, coarse → fine. */
export const MOVEMENT_GRANULARITIES = ['daily', '12h', '6h', '3h', '1h', '15m'] as const;
export type MovementGranularity = (typeof MOVEMENT_GRANULARITIES)[number];

/** Cadence change event surfaced for annotation on the time axis. */
export interface CadenceChange {
  ts: string;
  from: MovementGranularity;
  to: MovementGranularity;
}

interface MovementEnvelope {
  segmentId: string;
  gameId: string;
  fromDate: string;
  toDate: string;
  granularity: MovementGranularity | null;
  effectiveGranularity: MovementGranularity;
  cadenceChanges: CadenceChange[];
  carryForward: string[];
  asOf: string | null;
  /** Set when a stale (last-good) payload was served on upstream error. */
  stale?: boolean;
}

export interface KpiTrendPoint {
  ts: string;
  value: number | null;
  memberCount?: number;
}
export interface KpiTrendSeries {
  metricId: string;
  points: KpiTrendPoint[];
  carryForward: string[];
}
export interface KpiTrendResponse extends MovementEnvelope {
  series: KpiTrendSeries[];
}

export interface MovementPoint {
  ts: string;
  entered?: number;
  exited?: number;
  memberCount?: number;
}
export interface MovementResponse extends MovementEnvelope {
  points: MovementPoint[];
}

/** Wide row: one `ts` plus one numeric column per dimension bucket value. */
export type DistributionRow = { ts: string } & Record<string, number | string>;
export interface StateDistributionTrendResponse extends MovementEnvelope {
  dimension: string;
  rows: DistributionRow[];
  /** True when sensitive dimension values were withheld from a tokenless caller. */
  redacted: boolean;
}

interface RangeQuery {
  granularity?: MovementGranularity;
  from?: string;
  to?: string;
  days?: number;
}

function rangeParams(q: RangeQuery): Record<string, string | undefined> {
  return {
    granularity: q.granularity,
    from: q.from,
    to: q.to,
    days: q.days != null ? String(q.days) : undefined,
  };
}

export const segmentMovementClient = {
  kpiTrend(id: string, q: RangeQuery & { metrics?: string[] } = {}): Promise<KpiTrendResponse> {
    return apiFetch<KpiTrendResponse>(`/api/segments/${encodeURIComponent(id)}/kpi-trend`, {
      query: { ...rangeParams(q), metrics: q.metrics?.length ? q.metrics.join(',') : undefined },
    });
  },

  movement(id: string, q: RangeQuery = {}): Promise<MovementResponse> {
    return apiFetch<MovementResponse>(`/api/segments/${encodeURIComponent(id)}/movement`, {
      query: rangeParams(q),
    });
  },

  stateDistributionTrend(
    id: string,
    dimension: string,
    q: RangeQuery = {},
  ): Promise<StateDistributionTrendResponse> {
    return apiFetch<StateDistributionTrendResponse>(
      `/api/segments/${encodeURIComponent(id)}/state-distribution-trend`,
      { query: { ...rangeParams(q), dimension } },
    );
  },
};

/**
 * A view-time granularity is selectable only when it is no finer than what was
 * actually captured across the window. `effectiveGranularity` is the coarsest
 * cadence present in the range, so it is the finest the user may pick — coarser
 * options always work (they just collapse more points per bucket).
 */
export function isGranularitySelectable(
  option: MovementGranularity,
  effective: MovementGranularity,
): boolean {
  return MOVEMENT_GRANULARITIES.indexOf(option) <= MOVEMENT_GRANULARITIES.indexOf(effective);
}
