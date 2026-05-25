/**
 * Retention sweep — hard-purges sessions soft-deleted > 7 days ago.
 *
 * Writes tombstones at purge time (not at soft-delete time) so the snapshot
 * pipeline propagates only final deletions. Bounded to 200 rows per tick to
 * avoid long transactions. Idempotent: re-running on an already-purged set
 * is a no-op.
 *
 * Register via registerRetentionSweep(db) from index.ts before scheduler.start().
 */

import type Database from 'better-sqlite3';
import { scheduler } from './scheduler.js';
import { purgeSoftDeleted } from '../db/chat-store.js';
import { writeChatSnapshot } from '../db/snapshot-store.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** Cron: every hour on the hour. */
const RETENTION_CRON = '0 * * * *';

/**
 * Run one sweep tick: purge sessions deleted > 7d ago, then write snapshot
 * once if any rows were purged (single I/O, not per-row).
 */
export function runRetentionSweep(db: Database.Database): number {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const purged = purgeSoftDeleted(db, cutoff);
  if (purged > 0) {
    try {
      writeChatSnapshot(db);
    } catch {
      // Snapshot write is dev-only sync; failure must not crash the sweep.
    }
  }
  return purged;
}

/**
 * Register the hourly retention sweep cron job and run an immediate catch-up
 * sweep on startup so sessions that aged out while the service was down are
 * purged without waiting for the first cron tick.
 */
export function registerRetentionSweep(db: Database.Database): void {
  scheduler.register('retention-sweep', RETENTION_CRON, () => {
    runRetentionSweep(db);
  });

  // Catch-up sweep runs synchronously before scheduler.start() — safe because
  // better-sqlite3 is synchronous and the server isn't serving traffic yet.
  runRetentionSweep(db);
}
