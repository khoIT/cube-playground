/**
 * Pure, SDK-free retry logic for the Cube proxy's `429 Too Many Requests`
 * backpressure. Kept in its own module so it can be unit-tested WITHOUT
 * importing @cubejs-client/core, whose module-level native bindings OOM the
 * vitest workers. ResilientHttpTransport composes this around the SDK transport.
 *
 * The Cube transport contract: `request()` returns `{ subscribe(callback) }`,
 * and the transport hands the callback `(result, resubscribe)`. `resubscribe()`
 * re-runs the underlying fetch — exactly the retry primitive we need. We never
 * touch Cube's 200 + "Continue wait" long-poll: only HTTP 429 is retried.
 */

// Bounded so a sustained-busy backend fails in reasonable time rather than
// hanging under the wait budget. 4 retries with the delays below add ≲14s.
export const MAX_RETRIES = 4;
export const BASE_DELAY_MS = 600;
export const MAX_DELAY_MS = 4_000;

export type SubscribeCallback = (result: unknown, resubscribe: () => unknown) => unknown;
export type InnerSubscribe = (callback: SubscribeCallback) => unknown;

/** Sleep that resolves as soon as the request's signal aborts. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Delay before the next attempt: honour `Retry-After` (seconds), else backoff. */
export function retryDelayMs(
  result: unknown,
  attempt: number,
  rng: () => number = Math.random,
): number {
  const header = (result as Response)?.headers?.get?.('Retry-After');
  const retryAfterSec = header ? Number(header) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec >= 0) {
    return Math.min(retryAfterSec * 1000, MAX_DELAY_MS);
  }
  // Exponential backoff with full jitter so concurrent clients don't resync.
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.round(ceiling * (0.5 + rng() / 2));
}

/**
 * Wrap a transport's `subscribe` so a 429 result is retried (after a backoff
 * that honours Retry-After) up to MAX_RETRIES, instead of surfacing as a query
 * error. Every other result — including Cube's continue-wait long-poll — passes
 * straight through. Retries stop the moment `signal` aborts.
 *
 * `delayFn` is injectable for deterministic tests.
 */
export function createRetryingSubscribe(
  innerSubscribe: InnerSubscribe,
  signal?: AbortSignal,
  delayFn: (ms: number, signal?: AbortSignal) => Promise<void> = abortableDelay,
  delayMs: (result: unknown, attempt: number) => number = retryDelayMs,
): InnerSubscribe {
  let attempt = 0;
  return (callback: SubscribeCallback) => {
    const onResult: SubscribeCallback = async (result, resubscribe) => {
      const status = (result as Response)?.status;
      if (status === 429 && attempt < MAX_RETRIES && !signal?.aborted) {
        attempt += 1;
        await delayFn(delayMs(result, attempt), signal);
        // Bail if the client gave up during the wait; surface the 429 so the
        // load settles instead of spinning on a dead request.
        if (signal?.aborted) return callback(result, resubscribe);
        return resubscribe();
      }
      return callback(result, resubscribe);
    };
    return innerSubscribe(onResult);
  };
}
