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
import { pruneRefreshLog, DEFAULT_PRUNE_INTERVAL_MS } from './refresh-log-retention.js';
import { maybeRunAnomalyDetector } from './anomaly-detector.js';

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
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startCron(): void {
  if (interval) return;
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
