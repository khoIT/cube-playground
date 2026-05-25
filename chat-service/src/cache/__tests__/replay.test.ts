/**
 * Golden SSE event-stream test for replayCachedTurn.
 *
 * Verifies that the replay emits the same event *shape* as a live turn:
 *   token events (one or more, delta strings)
 *   result event (text, input_tokens=0, output_tokens=0, cost_usd=0)
 *
 * "Golden" means the field names and types are fixed; numeric values (0) are
 * hardcoded per spec (no LLM cost on cache hits).
 */

import { describe, it, expect } from 'vitest';
import { replayCachedTurn } from '../replay-cached-turn.js';
import type { CachedResponse } from '../../db/response-cache-store.js';
import type { SseEvent } from '../../types.js';
import { Writable } from 'node:stream';

function makeCached(text: string): CachedResponse {
  return {
    key: 'test-key',
    game_id: 'game-1',
    skill: 'explore',
    model: 'claude-test',
    user_text_normalized: 'show revenue',
    value_json: JSON.stringify({ text, toolCalls: [] }),
    input_tokens: 1000,
    output_tokens: 400,
    cost_usd: 0.005,
    hit_count: 0,
    created_at: Date.now(),
    last_hit_at: null,
    original_turn_id: 'orig-turn-id',
    original_session_id: 'orig-session-id',
    cube_meta_hash: null,
  };
}

/** Collect events emitted by replayCachedTurn into an array. */
async function collectEvents(cached: CachedResponse): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  const nullStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  await replayCachedTurn(cached, nullStream, (e) => events.push(e));
  return events;
}

describe('replayCachedTurn — golden SSE shape', () => {
  it('emits at least one token event followed by a result event', async () => {
    const text = 'Hello, this is a cached reply.';
    const events = await collectEvents(makeCached(text));

    const tokenEvents = events.filter((e) => e.type === 'token');
    const resultEvents = events.filter((e) => e.type === 'result');

    expect(tokenEvents.length).toBeGreaterThan(0);
    expect(resultEvents).toHaveLength(1);
    // result is always last
    expect(events[events.length - 1].type).toBe('result');
  });

  it('token deltas concatenate to the original text', async () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const events = await collectEvents(makeCached(text));
    const combined = events
      .filter((e) => e.type === 'token')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e) => (e as any).data.delta as string)
      .join('');
    expect(combined).toBe(text);
  });

  it('result event has zero cost and zero tokens (no LLM call)', async () => {
    const events = await collectEvents(makeCached('some reply'));
    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (result as any).data;
    expect(data.input_tokens).toBe(0);
    expect(data.output_tokens).toBe(0);
    expect(data.cost_usd).toBe(0);
  });

  it('result event text matches original cached text', async () => {
    const text = 'Revenue was $1.2M last month.';
    const events = await collectEvents(makeCached(text));
    const result = events.find((e) => e.type === 'result');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).data.text).toBe(text);
  });

  it('empty text produces no token events but still emits result', async () => {
    const events = await collectEvents(makeCached(''));
    const tokenEvents = events.filter((e) => e.type === 'token');
    const resultEvents = events.filter((e) => e.type === 'result');
    expect(tokenEvents).toHaveLength(0);
    expect(resultEvents).toHaveLength(1);
  });

  it('long text is chunked into multiple token events', async () => {
    const text = 'x'.repeat(250);
    const events = await collectEvents(makeCached(text));
    const tokenEvents = events.filter((e) => e.type === 'token');
    // 250 chars / 80 per chunk = 4 chunks (80+80+80+10)
    expect(tokenEvents.length).toBeGreaterThan(1);
  });

  it('throws on corrupt value_json', async () => {
    const bad: CachedResponse = { ...makeCached('ok'), value_json: '{not-json' };
    const nullStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
    await expect(replayCachedTurn(bad, nullStream)).rejects.toThrow('corrupt value_json');
  });
});
