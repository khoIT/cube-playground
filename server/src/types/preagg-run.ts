/**
 * Shared TypeScript types for the pre-aggregation run history system.
 *
 * Outcome taxonomy is the heart of the feature:
 *   sealed        — probe=built + no log error → refreshed and serving warm
 *   stale_serving — probe=built + log error    → old cache still serving (the key signal)
 *   failed        — probe∈{unbuilt,error} + log error → failed and not serveable
 *   unbuilt       — probe=unbuilt + no error   → never built / cold
 *
 * Because worker logs carry no game/securityContext, failures are rollup-level
 * (game-agnostic). A log error attributes to ALL games whose probe shows that
 * cube — this over-warns across shared cubes. That is the SAFE direction.
 */

export type Outcome = 'sealed' | 'stale_serving' | 'failed' | 'unbuilt';

/** Where the sweep record originated. */
export type SweepSource = 'scheduled' | 'probe-snapshot';

// ---------------------------------------------------------------------------
// DB input shapes (write path)
// ---------------------------------------------------------------------------

export interface PreaggSweepInput {
  startedAt: string;       // ISO — also the idempotency key
  endedAt: string | null;
  durationMs: number | null;
  source: SweepSource;
  gamesCount: number;
  rollupsTotal: number;
  sealedCount: number;
  staleCount: number;
  failedCount: number;
  unbuiltCount: number;
  /** 'online' | 'degraded' | 'disabled' — reflects docker-log-reader health */
  collectorStatus: string;
}

/** Per-rollup build stats within one game × cube of a sweep. */
export interface RollupBuildStat {
  rollup: string;
  /** Partition builds observed for this rollup (0 = unknown / legacy row). */
  partitions: number;
  /** Sum of partition-build durations for this rollup (ms; 0 = unknown). */
  buildMs: number;
  /** Earliest partition date rebuilt (raw batch suffix, YYYYMMDD or YYYYMM). */
  firstBatch?: string | null;
  /** Latest partition date rebuilt. With firstBatch answers "whole year or
   *  just yesterday?" for a slow sweep. */
  lastBatch?: string | null;
}

export interface PreaggSweepItemInput {
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
  /** Sum of partition-build durations observed for this game × cube (ms). */
  buildMs: number | null;
  /** Partition builds (CREATE TABLE completions) observed for this game × cube. */
  partitionsBuilt: number | null;
  /** Per-rollup build breakdown for this game × cube this sweep. */
  rollupsBuilt: RollupBuildStat[] | null;
}

// ---------------------------------------------------------------------------
// DB read shapes (returned from store)
// ---------------------------------------------------------------------------

export interface PreaggSweep extends PreaggSweepInput {
  id: number;
}

export interface PreaggSweepItem extends PreaggSweepItemInput {
  id: number;
}

// ---------------------------------------------------------------------------
// Parser output shapes (pure — no DB involvement)
// ---------------------------------------------------------------------------

export interface ParsedFailure {
  /** Full preAggregationId from the log line, e.g. "active_daily.dau_by_batch" */
  preAggregationId: string;
  /** Optional targetTableName / newVersionEntry.table_name from the log line */
  tableName?: string;
  /** Short normalized error signature for grouping: 'etimedout' | 'download-external' | 'table-not-found' | 'query-error' | 'unknown' */
  errorSig: string;
  /** Full error message string from the log line */
  errorMessage: string;
  /** ISO timestamp of the log line */
  ts: string;
}

/** One completed partition build observed in the log (CREATE TABLE line). */
export interface ParsedBuild {
  /** Schema short name from the table, e.g. 'cfm' in `preagg_cfm.…` —
   *  maps to a probe game id by prefix (cfm → cfm_vn). */
  schemaGame: string;
  /** Cube + rollup split from preAggregationId. */
  cube: string;
  rollup: string;
  /** Build duration in ms reported on the completed line. */
  durationMs: number;
  /** Partition start date from the table's batch suffix (YYYYMMDD/YYYYMM),
   *  null for non-partitioned rollups. */
  batchDate: string | null;
  ts: string;
}

export interface ParsedSweep {
  /** ISO timestamp parsed from the sweep-start line */
  startedAt: string;
  /** ISO timestamp of the last line processed in this sweep window */
  endedAt: string;
  failures: ParsedFailure[];
  /** Completed partition builds within this sweep window. */
  builds: ParsedBuild[];
}
