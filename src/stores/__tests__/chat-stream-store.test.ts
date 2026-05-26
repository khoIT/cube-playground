/**
 * Store-level behavior: refcount semantics, startTurn guard, alias resolution
 * across session_created, done → notifyChatSessionChanged.
 *
 * The store delegates per-event state to applySseEvent (covered in
 * `chat-stream-store-actions.test.ts`). These tests focus on the lifecycle
 * pieces that only the store owns.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Controllable SSE mock — push events from test, await flush.
type Ev = { type: string; data?: any };
const queue: Ev[] = [];
let resolve: (() => void) | null = null;
let closed = false;

function push(ev: Ev) {
  queue.push(ev);
  resolve?.();
  resolve = null;
}

function close() {
  closed = true;
  resolve?.();
  resolve = null;
}

async function* fakeStream(): AsyncIterable<Ev> {
  while (!closed || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
    while (queue.length > 0) yield queue.shift()!;
  }
}

vi.mock('../../api/chat-sse-client', () => ({
  openChatTurn: vi.fn(() => ({ stream: fakeStream(), cancel: vi.fn() })),
}));

const notifySpy = vi.fn();
vi.mock('../../shell/chat-overlay/chat-session-events', () => ({
  notifyChatSessionChanged: (id: string) => notifySpy(id),
  onChatSessionChanged: vi.fn(() => () => {}),
}));

import { useChatStreamStore } from '../chat-stream-store';

async function flush() {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  queue.length = 0;
  closed = false;
  resolve = null;
  notifySpy.mockClear();
  useChatStreamStore.setState({
    streams: new Map(),
    aliases: new Map(),
  });
});

describe('refcount semantics', () => {
  it('subscribe → unsubscribe increments and decrements without affecting status', () => {
    const s = useChatStreamStore.getState();
    s.subscribe('a');
    s.subscribe('a');
    expect(useChatStreamStore.getState().getEntry('a').refCount).toBe(2);
    s.unsubscribe('a');
    expect(useChatStreamStore.getState().getEntry('a').refCount).toBe(1);
    s.unsubscribe('a');
    expect(useChatStreamStore.getState().getEntry('a').refCount).toBe(0);
  });

  it('unsubscribe never goes negative', () => {
    const s = useChatStreamStore.getState();
    s.unsubscribe('a');
    s.unsubscribe('a');
    expect(useChatStreamStore.getState().getEntry('a').refCount).toBe(0);
  });
});

describe('startTurn guard', () => {
  it('is a silent no-op when a turn is already streaming for the same session', async () => {
    const s = useChatStreamStore.getState();
    // Kick off a turn; status becomes 'loading' synchronously.
    void s.startTurn({ sessionId: 'sess-1', message: 'hi', game: 'g' });
    await flush();
    expect(useChatStreamStore.getState().getEntry('sess-1').status).toBe('loading');

    // Second call must not start another turn. openChatTurn was mocked at
    // module scope — the call count tells us.
    const sseClient = await import('../../api/chat-sse-client');
    const openChatTurnMock = sseClient.openChatTurn as unknown as ReturnType<typeof vi.fn>;
    const before = openChatTurnMock.mock.calls.length;
    await s.startTurn({ sessionId: 'sess-1', message: 'hi again', game: 'g' });
    const after = openChatTurnMock.mock.calls.length;
    expect(after).toBe(before);

    close();
    await flush();
  });
});

describe('session_created alias', () => {
  it('subscribers using the new sessionId resolve to the same entry as those using null', async () => {
    const s = useChatStreamStore.getState();
    s.subscribe(null);
    void s.startTurn({ sessionId: null, message: 'hi', game: 'g' });
    await flush();

    push({ type: 'session_created', data: { id: 'sess-real' } });
    push({ type: 'token', data: { delta: 'partial' } });
    await flush();

    // Subscriber by null still sees the entry (alias not consulted; lives at '__new__').
    const byNull = useChatStreamStore.getState().getEntry(null);
    expect(byNull.currentText).toBe('partial');
    expect(byNull.sessionId).toBe('sess-real');

    // New subscriber using the real id resolves through the alias map.
    const byReal = useChatStreamStore.getState().getEntry('sess-real');
    expect(byReal.currentText).toBe('partial');
    expect(byReal.sessionId).toBe('sess-real');

    close();
    await flush();
  });
});

describe('done lifecycle', () => {
  it('fires notifyChatSessionChanged with the live session id', async () => {
    const s = useChatStreamStore.getState();
    void s.startTurn({ sessionId: null, message: 'hi', game: 'g' });
    await flush();

    push({ type: 'session_created', data: { id: 'sess-real' } });
    push({ type: 'token', data: { delta: 'all good' } });
    push({ type: 'done', data: {} });
    close();
    await flush();

    expect(useChatStreamStore.getState().getEntry(null).status).toBe('done');
    // Notified at session_created and again on done.
    expect(notifySpy).toHaveBeenCalledWith('sess-real');
    expect(notifySpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('cancel does not surface as "disconnected"', () => {
  it('user-initiated cancel mid-stream leaves status at idle, not disconnected', async () => {
    // Wire the mock's cancel handle to actually end the fake stream — matches
    // how openChatTurn aborts its underlying fetch when cancel() runs.
    const sseClient = await import('../../api/chat-sse-client');
    const openChatTurnMock = sseClient.openChatTurn as unknown as ReturnType<typeof vi.fn>;
    openChatTurnMock.mockImplementationOnce(() => ({
      stream: fakeStream(),
      cancel: () => close(),
    }));

    const s = useChatStreamStore.getState();
    void s.startTurn({ sessionId: 'sess-1', message: 'hi', game: 'g' });
    await flush();
    push({ type: 'token', data: { delta: 'partial' } });
    await flush();

    s.cancel('sess-1');
    await flush();

    // Before the fix this was 'disconnected' (Connection lost banner).
    expect(useChatStreamStore.getState().getEntry('sess-1').status).toBe('idle');
  });

  it('genuine premature close (no cancel) still stamps disconnected', async () => {
    const s = useChatStreamStore.getState();
    void s.startTurn({ sessionId: 'sess-2', message: 'hi', game: 'g' });
    await flush();
    push({ type: 'token', data: { delta: 'partial' } });
    await flush();

    // Server-side hangup: stream ends without 'done' and without a cancel call.
    close();
    await flush();

    expect(useChatStreamStore.getState().getEntry('sess-2').status).toBe('disconnected');
  });

  it('server-reported error is NOT clobbered by "disconnected" when stream ends without done', async () => {
    // Upstream LiteLLM proxy 403 path: chat-service emits an `error` event,
    // then closes the stream without a `done` event. The post-loop fallback
    // must preserve the explicit error so the user sees the actionable
    // message (e.g. "Failed to authenticate") instead of the generic
    // "Connection lost" banner.
    const s = useChatStreamStore.getState();
    void s.startTurn({ sessionId: 'sess-err', message: 'hi', game: 'g' });
    await flush();
    push({
      type: 'error',
      data: { code: 'agent_error', message: 'Failed to authenticate. API Error: 403 Forbidden' },
    });
    await flush();
    close();
    await flush();

    const entry = useChatStreamStore.getState().getEntry('sess-err');
    expect(entry.status).toBe('error');
    expect(entry.error).toBe('Failed to authenticate. API Error: 403 Forbidden');
  });

  it('rate_limited error survives a streamless close', async () => {
    const s = useChatStreamStore.getState();
    void s.startTurn({ sessionId: 'sess-rl', message: 'hi', game: 'g' });
    await flush();
    push({
      type: 'error',
      data: { code: 'rate_limited', message: 'slow down', retry_after_ms: 5000 },
    });
    await flush();
    close();
    await flush();

    const entry = useChatStreamStore.getState().getEntry('sess-rl');
    expect(entry.status).toBe('rate_limited');
    expect(entry.retryAfterMs).toBe(5000);
  });
});

describe('unmount does not cancel the live fetch', () => {
  it('refcount drops to 0 but the entry keeps accumulating events', async () => {
    const s = useChatStreamStore.getState();
    s.subscribe(null);
    void s.startTurn({ sessionId: null, message: 'hi', game: 'g' });
    await flush();
    push({ type: 'token', data: { delta: 'A' } });
    await flush();
    expect(useChatStreamStore.getState().getEntry(null).currentText).toBe('A');

    // Simulate the only subscriber unmounting.
    s.unsubscribe(null);
    expect(useChatStreamStore.getState().getEntry(null).refCount).toBe(0);

    // Stream keeps running.
    push({ type: 'token', data: { delta: 'B' } });
    await flush();
    expect(useChatStreamStore.getState().getEntry(null).currentText).toBe('AB');

    close();
    await flush();
  });
});
