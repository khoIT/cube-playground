/**
 * parseSseFromResponse — focused parser test. Guards against regressions in
 * the shared parser used by both openChatTurn and openChatTurnReplay.
 */
import { describe, it, expect } from 'vitest';
import { parseSseFromResponse } from '../chat-sse-client';

function makeResponse(text: string, status = 200): Response {
  // ReadableStream from a single chunk of bytes — most-realistic shape.
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(body, { status });
}

async function drain(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe('parseSseFromResponse', () => {
  it('parses two well-formed events', async () => {
    const body = [
      'event: token',
      'data: {"delta":"hi"}',
      '',
      'event: done',
      'data: {}',
      '',
      '',
    ].join('\n');
    const res = makeResponse(body);
    const events = await drain(
      parseSseFromResponse(res, new AbortController().signal),
    );
    expect(events).toEqual([
      { type: 'token', data: { delta: 'hi' } },
      { type: 'done', data: {} },
    ]);
  });

  it('skips events with malformed JSON data', async () => {
    const body = [
      'event: token',
      'data: {bad json',
      '',
      'event: done',
      'data: {}',
      '',
      '',
    ].join('\n');
    const res = makeResponse(body);
    const events = await drain(
      parseSseFromResponse(res, new AbortController().signal),
    );
    // Malformed event dropped; valid event still yields.
    expect(events).toEqual([{ type: 'done', data: {} }]);
  });

  it('emits an error event on non-2xx response', async () => {
    const body = JSON.stringify({ code: 'rate_limited', message: 'slow' });
    const res = makeResponse(body, 429);
    const events = await drain(
      parseSseFromResponse(res, new AbortController().signal),
    );
    expect(events).toEqual([
      { type: 'error', data: { code: 'rate_limited', message: 'slow' } },
    ]);
  });

  it('handles non-JSON error bodies gracefully', async () => {
    const res = makeResponse('something broke', 500);
    const events = await drain(
      parseSseFromResponse(res, new AbortController().signal),
    );
    expect(events).toHaveLength(1);
    const first = events[0] as { type: string; data: { code: string } };
    expect(first.type).toBe('error');
    expect(first.data.code).toBe('http_500');
  });
});
