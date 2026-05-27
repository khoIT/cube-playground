/**
 * Tests for chat-sse-client: feed a mocked ReadableStream, assert yielded events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openChatTurn, type SseEvent } from '../chat-sse-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a ReadableStream that emits SSE-formatted chunks from an array of events. */
function makeSseStream(events: Array<{ event: string; data: unknown }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const { event, data } of events) {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** Drain the AsyncIterable into an array. */
async function collect(iterable: AsyncIterable<SseEvent>): Promise<SseEvent[]> {
  const results: SseEvent[] = [];
  for await (const ev of iterable) {
    results.push(ev);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const origFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn() as typeof fetch;
});

afterEach(() => {
  global.fetch = origFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('openChatTurn', () => {
  it('yields 3 events from a mocked SSE stream in order', async () => {
    const mockEvents = [
      { event: 'loading', data: {} },
      { event: 'token', data: { delta: 'Hello' } },
      { event: 'done', data: {} },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: makeSseStream(mockEvents),
    });

    const { stream } = openChatTurn({ sessionId: 'test-session', message: 'hi', game: 'ptg' });
    const events = await collect(stream);

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'loading', data: {} });
    expect(events[1]).toEqual({ type: 'token', data: { delta: 'Hello' } });
    expect(events[2]).toEqual({ type: 'done', data: {} });
  });

  it('yields session_created with correct id', async () => {
    const mockEvents = [
      { event: 'session_created', data: { id: 'sess-abc' } },
      { event: 'done', data: {} },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: makeSseStream(mockEvents),
    });

    const { stream } = openChatTurn({ sessionId: null, message: 'hello', game: 'ptg' });
    const events = await collect(stream);

    expect(events[0]).toEqual({ type: 'session_created', data: { id: 'sess-abc' } });
  });

  it('yields an error event on non-2xx response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ code: 'turn_in_progress', message: 'busy' }),
    });

    const { stream } = openChatTurn({ sessionId: 'sess-1', message: 'hi', game: 'ptg' });
    const events = await collect(stream);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect((events[0] as { type: 'error'; data: { code: string } }).data.code).toBe('turn_in_progress');
  });

  it('cancel() aborts and produces no events', async () => {
    // Return a stream that never resolves (blocks on read) so we can cancel mid-flight.
    const encoder = new TextEncoder();
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const neverStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        // Enqueue nothing — stream is open but stalled.
        // We need to enqueue at least the first chunk so fetch resolves, then stall.
        controller.enqueue(encoder.encode(''));
      },
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: neverStream,
    });

    const { stream, cancel } = openChatTurn({ sessionId: 'sess-1', message: 'hi', game: 'ptg' });

    // Cancel immediately — before fully iterating.
    cancel();

    const events = await collect(stream);
    // After abort, the stream should terminate (possibly with 0 events).
    expect(events.length).toBe(0);

    // Ensure the stream is cleaned up.
    if (controllerRef) {
      try { (controllerRef as ReadableStreamDefaultController<Uint8Array>).close(); } catch { /* already closed */ }
    }
  });

  it('posts to correct URL for null sessionId (uses new)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: makeSseStream([{ event: 'done', data: {} }]),
    });

    const { stream } = openChatTurn({ sessionId: null, message: 'hi', game: 'ptg' });
    await collect(stream);

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe('/api/chat/sessions/new/turn');
    expect(callArgs[1]?.method).toBe('POST');
  });

  it('posts to correct URL for existing sessionId', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: makeSseStream([{ event: 'done', data: {} }]),
    });

    const { stream } = openChatTurn({ sessionId: 'uuid-123', message: 'hi', game: 'ptg' });
    await collect(stream);

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe('/api/chat/sessions/uuid-123/turn');
  });

  it('sends X-Web-Search: 1 when webSearch=true', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: makeSseStream([{ event: 'done', data: {} }]),
    });

    const { stream } = openChatTurn({ sessionId: null, message: 'hi', game: 'ptg', webSearch: true });
    await collect(stream);

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]?.headers?.['X-Web-Search']).toBe('1');
    expect(callArgs[1]?.headers?.['X-Research-Mode']).toBeUndefined();
  });

  it('sends X-Research-Mode: 1 when researchMode=true', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: makeSseStream([{ event: 'done', data: {} }]),
    });

    const { stream } = openChatTurn({ sessionId: null, message: 'hi', game: 'ptg', researchMode: true });
    await collect(stream);

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]?.headers?.['X-Research-Mode']).toBe('1');
    expect(callArgs[1]?.headers?.['X-Web-Search']).toBeUndefined();
  });

  it('sends both X-Web-Search and X-Research-Mode when both flags true', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: makeSseStream([{ event: 'done', data: {} }]),
    });

    const { stream } = openChatTurn({ sessionId: null, message: 'hi', game: 'ptg', webSearch: true, researchMode: true });
    await collect(stream);

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]?.headers?.['X-Web-Search']).toBe('1');
    expect(callArgs[1]?.headers?.['X-Research-Mode']).toBe('1');
  });

  it('omits X-Web-Search and X-Research-Mode when neither flag is set', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: makeSseStream([{ event: 'done', data: {} }]),
    });

    const { stream } = openChatTurn({ sessionId: null, message: 'hi', game: 'ptg' });
    await collect(stream);

    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]?.headers?.['X-Web-Search']).toBeUndefined();
    expect(callArgs[1]?.headers?.['X-Research-Mode']).toBeUndefined();
  });
});
