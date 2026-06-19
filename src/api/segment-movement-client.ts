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
export const MOVEMENT_GRANULARITIES = ['daily', '12h', '6h', '3h', '1h', '30m', '15m'] as const;
export type MovementGranularity = (typeof MOVEMENT_GRANULARITIES)[number];

/** Cadence change event surfaced for annotation on the time axis. */
export interface CadenceChange {
  ts: string;
  from: MovementGranularity;
  to: MovementGranularity;
}

/** A contiguous span of the window captured at one (finest-observed) cadence.
 *  Drives the capture-coverage strip: it shows WHERE in the window each grain
 *  actually lives, rather than a single window-wide enabled/greyed flag. */
export interface CaptureEra {
  from: string;
  to: string;
  cadence: MovementGranularity;
}

interface MovementEnvelope {
  segmentId: string;
  gameId: string;
  fromDate: string;
  toDate: string;
  granularity: MovementGranularity | null;
  effectiveGranularity: MovementGranularity;
  /** Finest grain captured anywhere in the window. */
  finestGranularity?: MovementGranularity;
  cadenceChanges: CadenceChange[];
  /** Per-era captured-cadence timeline (date-ascending). Optional for back-compat
   *  with older payloads / test fixtures; consumers default to [] (single daily). */
  captureEras?: CaptureEra[];
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

/** One captured snapshot in the per-segment ledger. `grain` is the observed
 *  capture cadence of the day this snapshot belongs to (agrees with the strip). */
export interface SnapshotLedgerRow {
  ts: string;
  grain: MovementGranularity;
  memberCount: number;
  kpiCount: number;
}
export interface SnapshotLedgerResponse {
  segmentId: string;
  gameId: string;
  fromDate: string;
  toDate: string;
  rows: SnapshotLedgerRow[];
  captureEras: CaptureEra[];
  finestGranularity: MovementGranularity;
  count: number;
  asOf: string | null;
  stale?: boolean;
}

/** Track cadence as exposed to the fleet page — capture/recompute schedule, or
 *  'Off' for on-demand only. Mirrors the server TrackCadence enum. */
export type FleetTrackCadence = 'Off' | MovementGranularity;
/** One segment's row in the fleet snapshot-coverage page. */
export interface SnapshotCoverageRow {
  segmentId: string;
  name: string;
  gameId: string | null;
  trackCadence: FleetTrackCadence;
  grains: MovementGranularity[];
  depthDays: number;
  lastSnapshotTs: string | null;
  eras: CaptureEra[];
}
export interface SnapshotCoverageResponse {
  fromDate: string;
  toDate: string;
  windowDays: number;
  rows: SnapshotCoverageRow[];
  stale?: boolean;
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

  snapshotLedger(id: string, q: Pick<RangeQuery, 'from' | 'to' | 'days'> = {}): Promise<SnapshotLedgerResponse> {
    return apiFetch<SnapshotLedgerResponse>(`/api/segments/${encodeURIComponent(id)}/snapshot-ledger`, {
      query: { from: q.from, to: q.to, days: q.days != null ? String(q.days) : undefined },
    });
  },

  snapshotCoverage(): Promise<SnapshotCoverageResponse> {
    return apiFetch<SnapshotCoverageResponse>('/api/segments/snapshot-coverage');
  },
};
