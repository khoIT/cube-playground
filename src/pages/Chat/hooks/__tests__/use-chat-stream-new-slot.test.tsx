/**
 * Regression: starting a new chat at /chat must not merge into the previous
 * session. Earlier the __new__ slot kept the previous chat's id after its
 * stream completed, leaking into the hook's returned `sessionId` and into
 * `liveSessionIdRef`, routing the next sendTurn to the prior session.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

type Ev = { type: string; data?: any };
const queue: Ev[] = [];
let resolveFn: (() => void) | null = null;
let closed = false;

function push(ev: Ev) {
  queue.push(ev);
  resolveFn?.();
  resolveFn = null;
}

function close() {
  closed = true;
  resolveFn?.();
  resolveFn = null;
}

async function* fakeStream(): AsyncIterable<Ev> {
  while (!closed || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((r) => {
        resolveFn = r;
      });
    }
    while (queue.length > 0) yield queue.shift()!;
  }
}

vi.mock('../../../../api/chat-sse-client', () => ({
  openChatTurn: vi.fn(() => ({ stream: fakeStream(), cancel: vi.fn() })),
}));

vi.mock('../../../../shell/chat-overlay/chat-session-events', () => ({
  notifyChatSessionChanged: vi.fn(),
  onChatSessionChanged: vi.fn(() => () => {}),
}));

import { useChatStream } from '../use-chat-stream';
import { useChatStreamStore } from '../../../../stores/chat-stream-store';

function Probe({ sessionId = null }: { sessionId?: string | null }) {
  const { sessionId: sid, status } = useChatStream({ sessionId, game: 'g' });
  return (
    <div>
      <span data-testid="sid">{String(sid)}</span>
      <span data-testid="status">{status}</span>
    </div>
  );
}

async function flush() {
  for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  queue.length = 0;
  closed = false;
  resolveFn = null;
  useChatStreamStore.setState({ streams: new Map(), aliases: new Map() });
});

describe('useChatStream — new-chat slot stale-state guard', () => {
  it('after a previous new chat completes, /chat does not inherit its sessionId', async () => {
    // Drive a prior new chat to done so __new__ holds {sessionId:'prev', status:'done'}.
    const store = useChatStreamStore.getState();
    void store.startTurn({ sessionId: null, message: 'first', game: 'g' });
    await flush();
    push({ type: 'session_created', data: { id: 'prev-sess' } });
    push({ type: 'token', data: { delta: 'reply' } });
    push({ type: 'done', data: {} });
    close();
    await flush();

    // Sanity: the store really does hold the stale state.
    const slot = useChatStreamStore.getState().getEntry(null);
    expect(slot.sessionId).toBe('prev-sess');
    expect(slot.status).toBe('done');

    // Mount the fresh new-chat surface — must NOT surface 'prev-sess'.
    const { getByTestId } = render(<Probe />);
    await flush();

    expect(getByTestId('sid').textContent).toBe('null');
    expect(getByTestId('status').textContent).toBe('idle');
  });

  it('mid-stream new-chat surface DOES see the live session id (in-flight guard)', async () => {
    // While the prior chat is still streaming, the same surface must still
    // observe the in-flight session id so the URL-replace effect can fire.
    const store = useChatStreamStore.getState();
    void store.startTurn({ sessionId: null, message: 'first', game: 'g' });
    await flush();
    push({ type: 'session_created', data: { id: 'live-sess' } });
    push({ type: 'token', data: { delta: 'partial' } });
    await flush();

    const { getByTestId } = render(<Probe />);
    await flush();

    // Streaming → guard does not strip; live id flows through.
    expect(getByTestId('sid').textContent).toBe('live-sess');
    expect(['loading', 'streaming']).toContain(getByTestId('status').textContent);

    close();
    await flush();
  });

  it('navigating to an older session id does not leak the latest new chat id', async () => {
    // Every new chat reuses the __new__ slot and registers `realId → __new__`
    // in the never-pruned alias map. After two sequential new chats, both
    // 'sess-1' and 'sess-2' alias to __new__, whose sessionId is now 'sess-2'.
    // Opening /chat/sess-1 must resolve to sess-1 (idle), NOT inherit sess-2 —
    // otherwise the route bounces to the latest session and sends merge there.
    const store = useChatStreamStore.getState();

    void store.startTurn({ sessionId: null, message: 'one', game: 'g' });
    await flush();
    push({ type: 'session_created', data: { id: 'sess-1' } });
    push({ type: 'done', data: {} });
    close();
    await flush();

    // Second new chat — reuses __new__, advances its sessionId to 'sess-2'.
    queue.length = 0;
    closed = false;
    resolveFn = null;
    void store.startTurn({ sessionId: null, message: 'two', game: 'g' });
    await flush();
    push({ type: 'session_created', data: { id: 'sess-2' } });
    push({ type: 'done', data: {} });
    close();
    await flush();

    // Both ids alias to the shared slot; the slot now reports 'sess-2'.
    expect(useChatStreamStore.getState().aliases.get('sess-1')).toBe('__new__');
    expect(useChatStreamStore.getState().getEntry(null).sessionId).toBe('sess-2');

    // Open the OLDER session — must surface its own id, not 'sess-2'.
    const { getByTestId } = render(<Probe sessionId="sess-1" />);
    await flush();

    expect(getByTestId('sid').textContent).toBe('sess-1');
  });
});
