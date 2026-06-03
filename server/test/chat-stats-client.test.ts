/**
 * chat-stats-client — the graceful-degradation contract for the admin bridge.
 * Every failure mode (missing secret, network error, timeout, non-200) must
 * resolve to null WITHOUT throwing, so the aggregator/admin route never 500s
 * or hangs on a slow/down chat-service.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchChatStatsBySub } from '../src/services/chat-stats-client.js';

describe('chat-stats-client', () => {
  const prev = process.env.INTERNAL_SECRET;

  beforeEach(() => { process.env.INTERNAL_SECRET = 'secret'; });
  afterEach(() => {
    if (prev === undefined) delete process.env.INTERNAL_SECRET;
    else process.env.INTERNAL_SECRET = prev;
  });

  it('returns {} for an empty sub list without calling fetch', async () => {
    let called = false;
    const res = await fetchChatStatsBySub([], { fetchImpl: (async () => { called = true; return new Response(); }) as typeof fetch });
    expect(res).toEqual({});
    expect(called).toBe(false);
  });

  it('returns null when INTERNAL_SECRET is unset (misconfigured → degrade)', async () => {
    delete process.env.INTERNAL_SECRET;
    const res = await fetchChatStatsBySub(['a'], { fetchImpl: (async () => new Response()) as typeof fetch });
    expect(res).toBeNull();
  });

  it('returns null on a network error', async () => {
    const res = await fetchChatStatsBySub(['a'], {
      fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch,
    });
    expect(res).toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    const res = await fetchChatStatsBySub(['a'], {
      fetchImpl: (async () => new Response('nope', { status: 503 })) as typeof fetch,
    });
    expect(res).toBeNull();
  });

  it('returns null on timeout (AbortController fires)', async () => {
    // fetchImpl that never resolves until its signal aborts → simulates a slow service.
    const slowFetch = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const res = await fetchChatStatsBySub(['a'], { fetchImpl: slowFetch, timeoutMs: 20 });
    expect(res).toBeNull();
  });

  it('returns the stats map on success and de-dupes subs in the request', async () => {
    let capturedUrl = '';
    const okFetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ stats: { a: { turns: 3, input_tokens: 1, output_tokens: 1, cost_usd: 0, by_skill: {} } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const res = await fetchChatStatsBySub(['a', 'a', 'b'], { fetchImpl: okFetch });
    expect(res).toEqual({ a: { turns: 3, input_tokens: 1, output_tokens: 1, cost_usd: 0, by_skill: {} } });
    // de-duped subs in the querystring
    expect(capturedUrl).toContain('subs=a%2Cb');
  });
});
