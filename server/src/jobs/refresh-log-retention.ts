/**
 * Refresh-log retention task.
 *
 * Pruning was inlined inside `refresh-segment.ts` (DELETE ... ts < -90 days
 * after each row insert). That coupled cleanup to refresh cadence — a segment
 * that stops refreshing leaves stale rows alive indefinitely, and a high-volume
 * segment runs the same delete on every tick.
 *
 * This module owns retention as a standalone job. The default cron runner
 * invokes `pruneRefreshLog()` once per scheduler tick (60s) at a coarse
 * interval — see `cron-runner.ts` for the throttle window. The actual cutoff
 * is `RETENTION_DAYS` (default 90, override via env).
 */

import { getDb } from '../db/sqlite.js';

export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1h

function retentionDays(): number {
  const raw = process.env.REFRESH_LOG_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

export interface PruneResult {
  removed: number;
  cutoffDays: number;
}

/**
 * Delete refresh-log rows older than `RETENTION_DAYS` (default 90).
 * Synchronous — sqlite is in-process. Returns the count for observability.
 */
export function pruneRefreshLog(): PruneResult {
  const db = getDb();
  const cutoffDays = retentionDays();
  const info = db
    .prepare(`DELETE FROM segment_refresh_log WHERE ts < datetime('now', ?)`)
    .run(`-${cutoffDays} days`);
  return { removed: info.changes ?? 0, cutoffDays };
}
