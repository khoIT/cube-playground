/**
 * Shared types for the Live KPI hook and its sub-modules.
 */

import type { Query } from '@cubejs-client/core';

export type RawRow = Record<string, unknown>;

export interface CubeMetaLike {
  meta(): Promise<{ cubesMap?: Record<string, unknown>; cubes?: Array<{ name: string }> }>;
}

export type CubeApiLike = CubeMetaLike & {
  load(q: Query): Promise<{ rawData(): RawRow[] }>;
};

export interface KpiTileData {
  id: string;
  label: string;
  /** Formatted display value. "—" when unavailable. */
  value: string;
  delta: string | null;
  /** positive/negative/neutral for delta color. */
  tone: 'positive' | 'negative' | 'neutral';
  /** Raw daily values for sparkline (last 14 days). Empty when unavailable. */
  sparkline: number[];
  /** True when this KPI could not be loaded for this game (missing cube). */
  unavailable: boolean;
  /** Human-readable reason for unavailability. */
  unavailableReason?: string;
  error: Error | null;
}

export interface UseLiveKpisResult {
  tiles: KpiTileData[];
  loading: boolean;
  lastRefresh: Date | null;
}
