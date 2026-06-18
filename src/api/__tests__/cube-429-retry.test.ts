/**
 * Unit tests for the SDK-free 429 retry logic. No @cubejs-client/core import,
 * so the vitest worker stays clear of the SDK's OOM-prone native bindings.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createRetryingSubscribe,
  retryDelayMs,
  MAX_RETRIES,
  MAX_DELAY_MS,
  type SubscribeCallback,
} from '../cube-429-retry';

/** Fake HTTP result with a status and optional Retry-After header. */
function res(status: number, retryAfter?: string): unknown {
  return {
    status,
    headers: { get: (k: string) => (k === 'Retry-After' ? (retryAfter ?? null) : null) },
  };
}

const noDelay = () => Promise.resolve();

/**
 * Drives an inner-subscribe stub that yields `sequence[i]` on each (re)subscribe.
 * Returns the final result the wrapped callback received + how many fetches ran.
 */
function run(sequence: unknown[], signal?: AbortSignal) {
  let fetchCount = 0;
  const innerSubscribe = (cb: SubscribeCallback): unknown => {
    const result = sequence[Math.min(fetchCount, sequence.length - 1)];
    fetchCount += 1;
    // The transport hands the callback (result, resubscribe); resubscribe re-runs.
    return cb(result, () => innerSubscribe(cb));
  };
  const wrapped = createRetryingSubscribe(innerSubscribe, signal, noDelay);
  return new Promise<{ final: unknown; fetchCount: number }>((resolve) => {
    const finalCb: SubscribeCallback = (result) => {
      resolve({ final: result, fetchCount });
      return undefined;
    };
    void wrapped(finalCb);
  });
}

describe('createRetryingSubscribe', () => {
  it('passes a 200 straight through with no retry', async () => {
    const ok = res(200);
    const { final, fetchCount } = await run([ok]);
    expect(final).toBe(ok);
    expect(fetchCount).toBe(1);
  });

  it('retries a 429 then resolves once a non-429 arrives', async () => {
    const ok = res(200);
    const { final, fetchCount } = await run([res(429), res(429), ok]);
    expect(final).toBe(ok);
    expect(fetchCount).toBe(3); // initial + 2 retries
  });

  it('gives up after MAX_RETRIES and surfaces the 429', async () => {
    const { final, fetchCount } = await run(Array(MAX_RETRIES + 5).fill(res(429)));
    expect((final as Response).status).toBe(429);
    expect(fetchCount).toBe(MAX_RETRIES + 1); // initial + MAX_RETRIES retries
  });

  it('stops retrying once the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { final, fetchCount } = await run([res(429), res(200)], controller.signal);
    expect((final as Response).status).toBe(429); // surfaced, not retried
    expect(fetchCount).toBe(1);
  });
});

describe('retryDelayMs', () => {
  it('honours Retry-After seconds, capped at MAX_DELAY_MS', () => {
    expect(retryDelayMs(res(429, '2'), 1)).toBe(2000);
    expect(retryDelayMs(res(429, '999'), 1)).toBe(MAX_DELAY_MS);
  });

  it('falls back to exponential backoff with jitter when no Retry-After', () => {
    // rng pinned → deterministic. attempt 1: ceiling 600, factor 0.5+1/2=1 → 600.
    expect(retryDelayMs(res(429), 1, () => 1)).toBe(600);
    // attempt 3: ceiling min(600*4, 4000)=2400, factor 0.5 → 1200.
    expect(retryDelayMs(res(429), 3, () => 0)).toBe(1200);
  });
});
