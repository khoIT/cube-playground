/**
 * Response-cache retention sweep — purges entries older than 24 hours.
 *
 * Runs hourly on the same cron schedule as the session retention sweep.
 * Bounded to 500 rows per tick via purgeExpired to keep transactions short.
 *
 * Register via registerResponseCacheSweep(db) from index.ts before scheduler.start().
 */

import type Database from 'better-sqlite3';
import { scheduler } from './scheduler.js';
import { purgeExpired } from '../db/response-cache-store.js';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
/** Same 1h cron as retention-sweep — no extra scheduler overhead. */
const CACHE_SWEEP_CRON = '0 * * * *';

/**
 * Run one sweep tick: purge response_cache rows older than 24 hours.
 * Returns the number of rows deleted.
 */
export function runResponseCacheSweep(db: Database.Database): number {
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  return purgeExpired(db, cutoff);
}

/**
 * Register the hourly cache sweep and run an immediate catch-up tick on startup
 * so entries that aged out while the service was down are purged without
 * waiting for the first cron tick.
 */
export function registerResponseCacheSweep(db: Database.Database): void {
  scheduler.register('response-cache-sweep', CACHE_SWEEP_CRON, () => {
    runResponseCacheSweep(db);
  });

  // Catch-up sweep runs synchronously before scheduler.start().
  runResponseCacheSweep(db);
}
