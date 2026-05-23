/**
 * Per-owner token-bucket rate limiter for POST /agent/turn.
 *
 * Each ownerId gets an independent bucket. Tokens refill at `refillPerMin`
 * per minute up to a maximum of `capacity`. If the bucket is empty the
 * request is rejected with HTTP 429.
 *
 * Only applied to POST /agent/turn — all other routes are unaffected.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

export interface RateLimiterOpts {
  /** Maximum tokens (burst capacity). */
  capacity: number;
  /** Tokens to add per minute (same as capacity for a sliding window). */
  refillPerMin: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number; // tokens per ms

  constructor(opts: RateLimiterOpts) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerMin / 60_000;
  }

  /**
   * Attempt to consume 1 token for ownerId.
   * Returns { ok: true } on success, or { ok: false, retryAfterMs } on exhaustion.
   */
  tryConsume(ownerId: string): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = Date.now();

    let bucket = this.buckets.get(ownerId);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillAt: now };
      this.buckets.set(ownerId, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefillAt;
    const added = elapsed * this.refillPerMs;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + added);
    bucket.lastRefillAt = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }

    // Calculate ms until the next token becomes available
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / this.refillPerMs);
    return { ok: false, retryAfterMs };
  }

  /** Exposed for testing — remove a specific bucket so it resets on next use. */
  clearBucket(ownerId: string): void {
    this.buckets.delete(ownerId);
  }
}

// ---------------------------------------------------------------------------
// Fastify hook factory
// ---------------------------------------------------------------------------

/**
 * Returns a Fastify onRequest hook that enforces the rate limit on
 * POST /agent/turn only. Other routes pass through immediately.
 */
export function buildRateLimitHook(limiter: RateLimiter) {
  return async function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Only guard the turn endpoint
    if (request.method !== 'POST' || !request.url.startsWith('/agent/turn')) {
      return;
    }

    const ownerId = request.headers['x-owner-id'];
    if (!ownerId || typeof ownerId !== 'string') {
      // Owner validation is done in the route handler; let it through here
      return;
    }

    const result = limiter.tryConsume(ownerId);
    if (!result.ok) {
      const retryAfterMs = result.retryAfterMs;
      void reply
        .status(429)
        .header('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
        .send({ code: 'rate_limited', retry_after_ms: retryAfterMs });
    }
  };
}
