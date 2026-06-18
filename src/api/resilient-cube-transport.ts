/**
 * HttpTransport that transparently retries `429 Too Many Requests` from the
 * Cube proxy's /load admission control (server/src/routes/cube-load-admission.ts).
 *
 * Why this layer: the proxy sheds load with a 429 + `Retry-After` when too many
 * DISTINCT queries are in flight. That is transient backpressure, not a query
 * error — surfacing it to the user as a failed chart would be wrong. We wait
 * (honouring Retry-After, else exponential backoff + jitter) and re-issue, so a
 * momentary pile-up self-heals and the user just sees a slightly slower load.
 *
 * The retry mechanics live in the SDK-free ./cube-429-retry module (so they can
 * be unit-tested without importing @cubejs-client/core); this class is the thin
 * SDK adapter. We wrap only the PUBLIC transport contract — the `{ subscribe }`
 * object the base returns — so we never re-implement request() (it touches
 * private fields) nor break Cube's continue-wait long-poll.
 */

import { HttpTransport } from '@cubejs-client/core';
import {
  createRetryingSubscribe,
  type InnerSubscribe,
  type SubscribeCallback,
} from './cube-429-retry';

type RequestParams = Parameters<HttpTransport['request']>;
type RequestResult = ReturnType<HttpTransport['request']>;

export class ResilientHttpTransport extends HttpTransport {
  // The per-request signal isn't exposed by the base class, so capture the
  // constructor signal ourselves to abort the backoff sleep promptly when the
  // client is torn down (opts.signal still wins per request).
  private readonly ctorSignal?: AbortSignal;

  constructor(options: ConstructorParameters<typeof HttpTransport>[0]) {
    super(options);
    this.ctorSignal = (options as { signal?: AbortSignal })?.signal;
  }

  request(apiMethod: RequestParams[0], opts: RequestParams[1]): RequestResult {
    const inner = super.request(apiMethod, opts) as unknown as {
      subscribe: InnerSubscribe;
    };
    const signal = (opts?.signal as AbortSignal | undefined) ?? this.ctorSignal;
    const subscribe = createRetryingSubscribe(
      (cb: SubscribeCallback) => inner.subscribe(cb),
      signal,
    );
    return { subscribe } as unknown as RequestResult;
  }
}
