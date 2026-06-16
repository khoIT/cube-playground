/**
 * Retention prune for the query-performance telemetry table.
 *
 * Deletes `query_perf` rows older than 30d — shorter than the activity spine's
 * 90d because this is high-volume time-series and only recent latency/failure
 * data is actionable. Single runner, daily tick; mirrors prune-activity-events.
 * Logs the number pruned (never silent truncation) so retention is observable.
 */

import { getDb } from '../db/sqlite.js';
import { pruneQueryPerfBefore } from '../services/query-perf-store.js';

export const QUERY_PERF_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

/** Run one prune pass. Returns rows removed. `now` injectable for tests. */
export function pruneQueryPerfTick(now: number = Date.now()): number {
  const cutoff = now - QUERY_PERF_RETENTION_DAYS * DAY_MS;
  const removed = pruneQueryPerfBefore(getDb(), cutoff);
  if (removed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[query-perf-prune] removed ${removed} row(s) older than ${QUERY_PERF_RETENTION_DAYS}d`);
  }
  return removed;
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startQueryPerfPruneCron(): void {
  if (interval) return;
  // Catch-up pass on boot, then daily.
  try {
    pruneQueryPerfTick();
  } catch {
    /* best-effort; next tick retries */
  }
  interval = setInterval(() => {
    try {
      pruneQueryPerfTick();
    } catch {
      /* best-effort */
    }
  }, TICK_INTERVAL_MS);
}

/** Test-only: stop the timer so a suite doesn't leak an open handle. */
export function __stopQueryPerfPruneCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
