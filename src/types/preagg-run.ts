/**
 * Client-side types for the pre-aggregation run history feature.
 * Mirror server/src/types/preagg-run.ts — keep in sync when the server
 * schema changes.
 */

export type Outcome = 'sealed' | 'stale_serving' | 'failed' | 'unbuilt';
export type SweepSource = 'scheduled' | 'probe-snapshot';

/** Compact "what actually built" line on sweep-list headers — names the
 *  games/rollups so the collapsed row is scannable without loading items. */
export interface SweepBuiltLine {
  game: string | null;
  cube: string | null;
  /** Rollup names that built partitions this sweep (empty for legacy rows). */
  rollups: string[];
  /** Total partition builds for this game × cube. */
  partitions: number;
}

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
  /** Present on list reads when the sweep rebuilt anything; slowest first. */
  built?: SweepBuiltLine[];
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
  /** Sum of partition-build durations for this game × cube (ms), if captured. */
  buildMs: number | null;
  /** Partition builds (CREATE TABLE completions) observed this sweep. */
  partitionsBuilt: number | null;
  /** Per-rollup build breakdown this sweep (slowest first). */
  rollupsBuilt: RollupBuildStat[] | null;
}

/** Per-rollup build stats within one game × cube of a sweep. */
export interface RollupBuildStat {
  rollup: string;
  /** Partition builds observed (0 = unknown / legacy row). */
  partitions: number;
  /** Summed build duration in ms (0 = unknown). */
  buildMs: number;
  /** Earliest / latest partition date rebuilt (raw batch suffix, YYYYMMDD or
   *  YYYYMM) — answers "whole year or just yesterday?" for a slow sweep. */
  firstBatch?: string | null;
  lastBatch?: string | null;
}

// ── Live triggered-build progress (GET /api/preagg-runs/build-progress) ─────
// Mirror server/src/services/preagg-build-progress.ts — keep in sync.

export type BuildRollupPhase = 'queued' | 'building' | 'finished' | 'failed';

export interface BuildRollupProgress {
  /** "<cube>.<rollup>" — Cube's preAggregationId. */
  id: string;
  cube: string;
  rollup: string;
  phase: BuildRollupPhase;
  /** Partition builds observed started / completed (a rollup = many partitions). */
  partitionsStarted: number;
  partitionsCompleted: number;
  errorSig: string | null;
  errorMessage: string | null;
  lastEventAt: string | null;
}

export interface BuildProgress {
  game: string | null;
  startedAt: string;
  /** Trigger script finish time; null while the build window is open. */
  finishedAt: string | null;
  /** True when docker logs were unreadable — rollup list may be empty/stale. */
  degraded: boolean;
  rollups: BuildRollupProgress[];
  totals: { queued: number; building: number; finished: number; failed: number };
}
