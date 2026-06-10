/**
 * In-process tick-every-60s scheduler for live segment refreshes.
 *
 * Picks up `type='predicate'` segments whose last_refreshed_at age has
 * exceeded their refresh_cadence_min and enqueues them on the refresh queue.
 * Single-instance assumption (documented in plan); v1.5 will add advisory
 * locks for multi-instance deployments.
 */

import { getDb } from '../db/sqlite.js';
import { enqueueRefresh } from './refresh-queue.js';
import { reconcileOrphanedRefreshing } from '../services/segment-status.js';
import { pruneRefreshLog, DEFAULT_PRUNE_INTERVAL_MS } from './refresh-log-retention.js';
import { maybeRunAnomalyDetector } from './anomaly-detector.js';
import { maybeRunMember360Precompute } from '../services/member360-precompute-scheduler.js';

const TICK_INTERVAL_MS = 60_000;

let lastPruneAt = 0;

function maybePruneRefreshLog(now: number): void {
  if (now - lastPruneAt < DEFAULT_PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  try {
    const result = pruneRefreshLog();
    if (result.removed > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[refresh-log-retention] pruned ${result.removed} rows older than ${result.cutoffDays}d`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[refresh-log-retention] prune failed:', (err as Error).message);
  }
}

interface DueRow {
  id: string;
}

export function listDueSegments(now: number = Date.now()): string[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT id, refresh_cadence_min, last_refreshed_at, status
        FROM segments
       WHERE type = 'predicate'
         AND cube_query_json IS NOT NULL
         AND refresh_cadence_min IS NOT NULL
    `)
    .all() as Array<{
      id: string;
      refresh_cadence_min: number;
      last_refreshed_at: string | null;
      status: string;
    }>;

  const due: string[] = [];
  for (const r of rows) {
    if (r.status === 'refreshing') continue;
    if (!r.last_refreshed_at) {
      due.push(r.id);
      continue;
    }
    const lastMs = Date.parse(r.last_refreshed_at);
    const ageMs = now - lastMs;
    if (ageMs >= r.refresh_cadence_min * 60 * 1000) due.push(r.id);
  }
  return due;
}

export async function tick(): Promise<void> {
  maybePruneRefreshLog(Date.now());
  const ids = listDueSegments();
  for (const id of ids) {
    await enqueueRefresh(id);
  }
  await maybeRunAnomalyDetector().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[anomaly-detector] tick failed:', (err as Error).message);
  });
  // Nightly member-360 precompute — self-gates on its window + running flag.
  await maybeRunMember360Precompute().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[member360-precompute] tick failed:', (err as Error).message);
  });
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startCron(): void {
  if (interval) return;
  // Recover segments orphaned mid-refresh by a previous process: the queue is
  // in-memory, so any 'refreshing' row at boot is wedged and would otherwise be
  // skipped by listDueSegments() forever. Reset to 'stale' so the first tick
  // below re-enqueues them.
  try {
    const reset = reconcileOrphanedRefreshing();
    if (reset > 0) {
      // eslint-disable-next-line no-console
      console.log(`[cron] reconciled ${reset} orphaned 'refreshing' segment(s) → 'stale'`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[cron] orphan reconciliation failed:', (err as Error).message);
  }
  // Fire one tick immediately so a freshly-created live segment doesn't wait 60s.
  void tick().catch(() => {});
  interval = setInterval(() => {
    void tick().catch(() => {});
  }, TICK_INTERVAL_MS);
}

export function stopCron(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
