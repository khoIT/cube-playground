/**
 * Unit tests for rate-limit middleware.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter, buildRateLimitHook } from '../src/middleware/rate-limit.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// RateLimiter unit tests
// ---------------------------------------------------------------------------

describe('RateLimiter.tryConsume', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter({ capacity: 3, refillPerMin: 3 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to capacity requests consecutively', () => {
    expect(limiter.tryConsume('alice')).toEqual({ ok: true });
    expect(limiter.tryConsume('alice')).toEqual({ ok: true });
    expect(limiter.tryConsume('alice')).toEqual({ ok: true });
  });

  it('rejects the 4th request when capacity is 3', () => {
    limiter.tryConsume('alice');
    limiter.tryConsume('alice');
    limiter.tryConsume('alice');
    const result = limiter.tryConsume('alice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('gives independent buckets to different owners', () => {
    limiter.tryConsume('alice');
    limiter.tryConsume('alice');
    limiter.tryConsume('alice');

    // bob's bucket is untouched
    expect(limiter.tryConsume('bob')).toEqual({ ok: true });
  });

  it('refills tokens after a full minute has elapsed', () => {
    // Drain alice's bucket
    limiter.tryConsume('alice');
    limiter.tryConsume('alice');
    limiter.tryConsume('alice');
    expect(limiter.tryConsume('alice').ok).toBe(false);

    // Advance time by 60 seconds — enough for a full refill
    vi.advanceTimersByTime(60_000);

    expect(limiter.tryConsume('alice')).toEqual({ ok: true });
  });

  it('partially refills after half a minute', () => {
    // Drain all 3 tokens
    limiter.tryConsume('alice');
    limiter.tryConsume('alice');
    limiter.tryConsume('alice');

    // Advance 30s — adds 1.5 tokens (floor: 1 usable token)
    vi.advanceTimersByTime(30_000);

    expect(limiter.tryConsume('alice')).toEqual({ ok: true });
    // Second attempt should fail again (only ~0.5 token left)
    expect(limiter.tryConsume('alice').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRateLimitHook integration
// ---------------------------------------------------------------------------

function makeReply(): {
  code: number;
  sent: unknown;
  status: (n: number) => FastifyReply;
  header: (name: string, value: string) => FastifyReply;
  send: (body: unknown) => FastifyReply;
} {
  const reply = {
    code: 0,
    sent: undefined as unknown,
    status(n: number) {
      reply.code = n;
      return reply as unknown as FastifyReply;
    },
    header(_name: string, _value: string) {
      return reply as unknown as FastifyReply;
    },
    send(body: unknown) {
      reply.sent = body;
      return reply as unknown as FastifyReply;
    },
  };
  return reply;
}

function makeRequest(method: string, url: string, ownerId?: string): FastifyRequest {
  return {
    method,
    url,
    headers: ownerId ? { 'x-owner-id': ownerId } : {},
  } as unknown as FastifyRequest;
}

describe('buildRateLimitHook', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ capacity: 2, refillPerMin: 2 });
  });

  it('passes through non-turn routes without consuming tokens', async () => {
    const hook = buildRateLimitHook(limiter);
    const reply = makeReply();

    await hook(makeRequest('GET', '/sessions', 'alice'), reply as unknown as FastifyReply);
    await hook(makeRequest('GET', '/sessions', 'alice'), reply as unknown as FastifyReply);
    await hook(makeRequest('DELETE', '/sessions/123', 'alice'), reply as unknown as FastifyReply);

    // No 429 sent
    expect(reply.code).toBe(0);
  });

  it('allows up to capacity POST /agent/turn requests', async () => {
    const hook = buildRateLimitHook(limiter);
    const reply = makeReply();

    await hook(makeRequest('POST', '/agent/turn', 'alice'), reply as unknown as FastifyReply);
    await hook(makeRequest('POST', '/agent/turn', 'alice'), reply as unknown as FastifyReply);

    expect(reply.code).toBe(0);
  });

  it('returns 429 when the bucket is exhausted', async () => {
    const hook = buildRateLimitHook(limiter);
    const r1 = makeReply();
    const r2 = makeReply();
    const r3 = makeReply();

    await hook(makeRequest('POST', '/agent/turn', 'alice'), r1 as unknown as FastifyReply);
    await hook(makeRequest('POST', '/agent/turn', 'alice'), r2 as unknown as FastifyReply);
    await hook(makeRequest('POST', '/agent/turn', 'alice'), r3 as unknown as FastifyReply);

    expect(r3.code).toBe(429);
    expect((r3.sent as Record<string, unknown>).code).toBe('rate_limited');
    expect(typeof (r3.sent as Record<string, unknown>).retry_after_ms).toBe('number');
  });

  it('skips rate-limit when x-owner-id header is absent', async () => {
    const hook = buildRateLimitHook(limiter);
    const reply = makeReply();

    // No ownerId — hook should not block (route validates this separately)
    await hook(makeRequest('POST', '/agent/turn'), reply as unknown as FastifyReply);
    expect(reply.code).toBe(0);
  });
});
