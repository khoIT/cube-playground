/**
 * Per-key rate limiting for the public export surface.
 *
 * Two bounds, both in-memory (single `server` replica in prod — same constraint
 * as the snapshot job; resets on restart, which is acceptable):
 *   1. Concurrency — max N simultaneous streams per key (a long full-cohort pull
 *      holds a Trino connection for a while; cap the fan-out).
 *   2. Daily pull quota — max M pulls per key per GMT+7 day (matches ops
 *      conventions; resets at Asia/Saigon midnight).
 *
 * Over either bound → the route returns 429 with a Retry-After. Mirrors the
 * in-memory counter approach of `cube-load-admission.ts`.
 */

const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;

// Read per-call (not a module-load snapshot) so env overrides apply at runtime.
const maxConcurrent = () => Number(process.env.PUBLIC_EXPORT_MAX_CONCURRENT_PER_KEY) || 2;
const maxPullsPerDay = () => Number(process.env.PUBLIC_EXPORT_MAX_PULLS_PER_DAY) || 50;

export class RateLimitRejected extends Error {
  constructor(
    public readonly reason: 'concurrency' | 'quota',
    public readonly retryAfterSec: number,
  ) {
    super(`Public export rate limit reached (${reason})`);
    this.name = 'RateLimitRejected';
  }
}

const concurrent = new Map<string, number>();
const dailyPulls = new Map<string, { day: string; count: number }>();

/** Current calendar day in GMT+7 (YYYY-MM-DD) — Vietnam has no DST. */
function gmt7Day(now = Date.now()): string {
  return new Date(now + GMT7_OFFSET_MS).toISOString().slice(0, 10);
}

/** Seconds until the next GMT+7 midnight (when the daily quota resets). */
function secondsUntilGmt7Midnight(now = Date.now()): number {
  const shifted = now + GMT7_OFFSET_MS;
  const msIntoDay = shifted % 86_400_000;
  return Math.max(1, Math.ceil((86_400_000 - msIntoDay) / 1000));
}

/**
 * Admit one pull for `keyId`. Throws {@link RateLimitRejected} when over a bound.
 * On success returns a release fn the caller MUST invoke (in a finally) when the
 * stream ends — releases the concurrency slot. The daily counter is NOT
 * decremented on release (it counts pulls per day, not in-flight).
 */
export function acquireExportSlot(keyId: string): () => void {
  const day = gmt7Day();
  const dp = dailyPulls.get(keyId);
  const counter = dp && dp.day === day ? dp : { day, count: 0 };
  if (counter.count >= maxPullsPerDay()) {
    throw new RateLimitRejected('quota', secondsUntilGmt7Midnight());
  }

  const inflight = concurrent.get(keyId) ?? 0;
  if (inflight >= maxConcurrent()) {
    throw new RateLimitRejected('concurrency', 30);
  }

  concurrent.set(keyId, inflight + 1);
  counter.count += 1;
  dailyPulls.set(keyId, counter);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (concurrent.get(keyId) ?? 1) - 1;
    if (n <= 0) concurrent.delete(keyId);
    else concurrent.set(keyId, n);
  };
}

/** Test-only: reset module state between cases. */
export function __resetRateLimiter(): void {
  concurrent.clear();
  dailyPulls.clear();
}
