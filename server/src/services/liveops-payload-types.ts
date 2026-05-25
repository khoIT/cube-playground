/**
 * Shared payload shapes for liveops result cache.
 * FE consumers read these via /api/liveops/* endpoints.
 */

export interface KpiStripTile {
  id: string;
  label: string;
  /** Latest numeric value, null when no data. */
  latest: number | null;
  /** Delta as a unit ratio (0.05 = +5%), null when window not satisfied. */
  delta: number | null;
  /** Daily values, oldest → newest. */
  sparkline: number[];
  /** Raw numeric format hint so FE can pick a formatter. */
  format?: 'number' | 'currency' | 'percent';
  deltaWindow: '1d' | '7d';
  invertDelta?: boolean;
  /** True when the cube/metric isn't defined for this game. */
  unavailable: boolean;
  unavailableReason?: string;
  errorMsg?: string;
}

export interface KpiStripPayload {
  game: string;
  tiles: KpiStripTile[];
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
