/**
 * Client-side types for the pre-aggregation run history feature.
 * Mirror server/src/types/preagg-run.ts — keep in sync when the server
 * schema changes.
 */

export type Outcome = 'sealed' | 'stale_serving' | 'failed' | 'unbuilt';
export type SweepSource = 'scheduled' | 'probe-snapshot';

export interface PreaggSweep {
  id: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  source: SweepSource;
  gamesCount: number;
  rollupsTotal: number;
  sealedCount: number;
  staleCount: number;
  failedCount: number;
  unbuiltCount: number;
  collectorStatus: string;
}

export interface PreaggSweepItem {
  id: number;
  sweepId: number;
  game: string | null;
  cube: string | null;
  rollup: string | null;
  outcome: Outcome;
  serveable: boolean;
  lastSealedAt: string | null;
  errorSig: string | null;
  errorMessage: string | null;
  observedAt: string;
}
