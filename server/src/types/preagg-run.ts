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

export interface ParsedSweep {
  /** ISO timestamp parsed from the sweep-start line */
  startedAt: string;
  /** ISO timestamp of the last line processed in this sweep window */
  endedAt: string;
  failures: ParsedFailure[];
}
