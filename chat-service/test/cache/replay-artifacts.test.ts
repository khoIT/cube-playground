/**
 * replayCachedTurn — artifact + chart emission + freshness flag.
 * Locks in the post-Phase-2 behavior:
 *   - result event carries cache_hit=true
 *   - default freshness is 'stale' when no refresh hook is provided
 *   - cached artifacts/charts are re-emitted as SSE events
 *   - refresh hook controls the final freshness value
 */

import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { replayCachedTurn } from '../../src/cache/replay-cached-turn.js';
import type { CachedResponse } from '../../src/db/response-cache-store.js';
import type { SseEvent } from '../../src/types.js';

function makeCached(valueJson: string): CachedResponse {
  return {
    key: 'k',
    game_id: 'g1',
    skill: 'explore',
    model: 'claude-test',
    user_text_normalized: 'q',
    value_json: valueJson,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    hit_count: 0,
    created_at: Date.now(),
    last_hit_at: null,
    original_turn_id: 'orig',
    original_session_id: 'sess',
    cube_meta_hash: null,
  };
}

const nullStream = new Writable({ write(_c, _e, cb) { cb(); } });

describe('replayCachedTurn — cache_hit + freshness', () => {
  it('result event carries cache_hit=true and freshness=stale when no refresh hook', async () => {
    const cached = makeCached(JSON.stringify({ text: 'hello', toolCalls: [] }));
    const events: SseEvent[] = [];
    await replayCachedTurn(cached, nullStream, (e) => events.push(e));

    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (result as any).data;
    expect(data.cache_hit).toBe(true);
    expect(data.cache_freshness).toBe('stale');
  });

  it('emits query_artifact + chart events for cached payloads', async () => {
    const cachedValue = {
      text: 'hi',
      toolCalls: [],
      artifacts: [{
        id: 'a1', title: 'q', summary: 's', game: 'g1', query: { measures: [] },
        source: 'raw', deeplinkUrl: '/playground?q=a1', deeplinkVia: 'inline',
      }],
      charts: [{
        id: 'c1',
        spec: { type: 'bar', title: 't', data: [{ x: 1 }], encoding: { category: 'x', value: 'x' } },
        truncated: false, originalRowCount: 1, artifactRef: 'a1',
      }],
    };
    const events: SseEvent[] = [];
    await replayCachedTurn(makeCached(JSON.stringify(cachedValue)), nullStream, (e) => events.push(e));
    expect(events.filter((e) => e.type === 'query_artifact')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'chart')).toHaveLength(1);
  });

  it('refresh hook outcome propagates to result event freshness', async () => {
    const cachedValue = {
      text: 'hi',
      toolCalls: [],
      artifacts: [{
        id: 'a1', title: 'q', summary: 's', game: 'g1', query: { measures: [] },
        source: 'raw', deeplinkUrl: '/playground?q=a1', deeplinkVia: 'inline',
      }],
      charts: [{
        id: 'c1',
        spec: { type: 'bar', title: 't', data: [{ x: 1 }], encoding: { category: 'x', value: 'x' } },
        truncated: false, originalRowCount: 1, artifactRef: 'a1',
      }],
    };
    const events: SseEvent[] = [];
    await replayCachedTurn(
      makeCached(JSON.stringify(cachedValue)),
      nullStream,
      (e) => events.push(e),
      async (artifacts, charts) => ({ artifacts, charts, freshness: 'refreshed' }),
    );
    const result = events.find((e) => e.type === 'result');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).data.cache_freshness).toBe('refreshed');
  });

  it('refresh hook is not invoked when payload has neither artifacts nor charts', async () => {
    let hookCalled = false;
    const cached = makeCached(JSON.stringify({ text: 'plain', toolCalls: [] }));
    await replayCachedTurn(cached, nullStream, () => {}, async (a, c) => {
      hookCalled = true;
      return { artifacts: a, charts: c, freshness: 'refreshed' };
    });
    expect(hookCalled).toBe(false);
  });

  it('refresh hook errors fall through to stale (no throw to caller)', async () => {
    const cachedValue = {
      text: 'hi',
      toolCalls: [],
      artifacts: [{
        id: 'a1', title: 'q', summary: 's', game: 'g1', query: { measures: [] },
        source: 'raw', deeplinkUrl: '/playground?q=a1', deeplinkVia: 'inline',
      }],
      charts: [],
    };
    const events: SseEvent[] = [];
    await replayCachedTurn(
      makeCached(JSON.stringify(cachedValue)),
      nullStream,
      (e) => events.push(e),
      async () => { throw new Error('cube down'); },
    );
    const result = events.find((e) => e.type === 'result');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).data.cache_freshness).toBe('stale');
  });
});
