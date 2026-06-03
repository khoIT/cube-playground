/**
 * Retention prune for the activity telemetry spine.
 *
 * Deletes `activity_events` older than the retention horizon (90d). Single
 * runner, daily tick; mirrors the existing cache-cron pattern. Logs the number
 * of rows pruned (never silent truncation) so retention is observable. Read
 * contention with the aggregator is acceptable — this is a low-frequency
 * delete on an indexed column; no locking is warranted.
 */

import { getDb } from '../db/sqlite.js';
import { pruneActivityBefore } from '../services/activity-store.js';

export const ACTIVITY_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

/** Run one prune pass. Returns rows removed. `now` injectable for tests. */
export function pruneActivityEventsTick(now: number = Date.now()): number {
  const cutoff = now - ACTIVITY_RETENTION_DAYS * DAY_MS;
  const removed = pruneActivityBefore(getDb(), cutoff);
  if (removed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[activity-prune] removed ${removed} event(s) older than ${ACTIVITY_RETENTION_DAYS}d`);
  }
  return removed;
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startActivityPruneCron(): void {
  if (interval) return;
  // Catch-up pass on boot, then daily.
  try {
    pruneActivityEventsTick();
  } catch {
    /* best-effort; next tick retries */
  }
  interval = setInterval(() => {
    try {
      pruneActivityEventsTick();
    } catch {
      /* best-effort */
    }
  }, TICK_INTERVAL_MS);
}

/** Test-only: stop the timer so a suite doesn't leak an open handle. */
export function __stopActivityPruneCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
