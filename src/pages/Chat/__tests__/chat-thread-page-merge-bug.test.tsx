/**
 * Regression: starting at /chat/<existing-id> then navigating to /chat and
 * submitting a new message MUST create a brand-new session — the message
 * MUST NOT be appended to the previous session.
 *
 * This is the user-reported bug from session URL d88e5ae0-...: the prior
 * useChatStream selector fix covers the case where __new__ holds a stale
 * entry from a prior new chat, but the user-reported scenario opens an
 * existing session DIRECTLY (no __new__ entry involved) and then navigates
 * to /chat — exercising a different leak path.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, useLocation, useHistory } from 'react-router-dom';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

type SseEvent = { type: string; data?: any };

// One SSE queue per opened turn so we can verify which session the BACKEND
// receives the message for.
const turns: Array<{ sessionId: string | null; queue: SseEvent[]; resolve: (() => void) | null; closed: boolean }> = [];

function currentTurn() {
  return turns[turns.length - 1];
}

function pushEvent(ev: SseEvent) {
  const t = currentTurn();
  if (!t) return;
  t.queue.push(ev);
  t.resolve?.();
  t.resolve = null;
}

function closeStream() {
  const t = currentTurn();
  if (!t) return;
  t.closed = true;
  t.resolve?.();
  t.resolve = null;
}

async function* fakeStreamFor(idx: number): AsyncIterable<SseEvent> {
  while (!turns[idx].closed || turns[idx].queue.length > 0) {
    if (turns[idx].queue.length === 0) {
      await new Promise<void>((res) => {
        turns[idx].resolve = res;
      });
    }
    while (turns[idx].queue.length > 0) yield turns[idx].queue.shift()!;
  }
}

interface OpenOpts {
  sessionId: string | null;
  message: string;
  game: string;
  context?: unknown;
  mode?: 'targeted' | 'aggressive';
  bypassCache?: boolean;
}

const openChatTurnSpy = vi.fn((opts: OpenOpts) => {
  const idx = turns.length;
  turns.push({ sessionId: opts.sessionId, queue: [], resolve: null, closed: false });
  return { stream: fakeStreamFor(idx), cancel: vi.fn() };
});

vi.mock('../../../api/chat-sse-client', () => ({
  openChatTurn: (opts: any) => openChatTurnSpy(opts),
}));

// useChatSession: for the existing-id mount, return a tiny session payload so
// the page hydrates the prior turn into committedMessages.
vi.mock('../hooks/use-chat-session', () => ({
  useChatSession: (id: string | null) => {
    if (!id) return { session: null, isLoading: false, refetch: vi.fn() };
    return {
      session: {
        id,
        ownerId: 'dev',
        gameId: 'ptg',
        createdAt: new Date().toISOString(),
        activeTurnId: null,
        turns: [
          { id: 't1', role: 'user', text: 'Old question', createdAt: new Date().toISOString() },
          { id: 't2', role: 'assistant', text: 'Old answer', createdAt: new Date().toISOString() },
        ],
      },
      isLoading: false,
      refetch: vi.fn(),
    };
  },
}));

vi.mock('../hooks/use-chat-sessions-list', () => ({
  useChatSessionsList: () => ({ sessions: [], isLoading: false, refetch: vi.fn() }),
}));

vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'ptg',
}));

const setActiveSpy = vi.fn();
vi.mock('../../../shell/chat-overlay/use-active-chat-session', () => ({
  setActiveChatSession: (id: string | null) => setActiveSpy(id),
  useActiveChatSession: () => [null, vi.fn()],
  getActiveChatSession: () => null,
}));

vi.mock('../../../shell/sidebar/recent-items-store', () => ({
  pushRecent: vi.fn(),
}));

vi.mock('../../../shell/chat-overlay/chat-session-events', () => ({
  notifyChatSessionChanged: vi.fn(),
  onChatSessionChanged: vi.fn(() => () => {}),
}));

vi.mock('../hooks/use-window-width', () => ({
  useWindowWidth: () => 1200,
}));

import { ChatThreadPage } from '../chat-thread-page';
import { useChatStreamStore } from '../../../stores/chat-stream-store';

function LocationProbe({ onChange }: { onChange: (p: string) => void }) {
  const loc = useLocation();
  React.useEffect(() => onChange(loc.pathname), [loc.pathname, onChange]);
  return null;
}

/** Renders a button that drives history.push so we can simulate sidebar nav. */
function NavButton({ to }: { to: string }) {
  const history = useHistory();
  return (
    <button data-testid="nav-btn" onClick={() => history.push(to)}>
      go
    </button>
  );
}

async function flush() {
  for (let i = 0; i < 20; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

const EXISTING_ID = 'd88e5ae0-a63d-4d34-9623-f8220bd13a5b';

describe('Chat — navigating /chat/<existing-id> → /chat must not merge', () => {
  beforeEach(() => {
    turns.length = 0;
    openChatTurnSpy.mockClear();
    setActiveSpy.mockClear();
    useChatStreamStore.setState({ streams: new Map(), aliases: new Map() });
  });
  afterEach(() => {
    closeStream();
  });

  it('new chat after viewing existing session sends sessionId=null to backend', async () => {
    const onLoc = vi.fn();
    render(
      <MemoryRouter initialEntries={[`/chat/${EXISTING_ID}`]}>
        <Route path="/chat/:id?" component={ChatThreadPage} />
        <LocationProbe onChange={onLoc} />
        <NavButton to="/chat" />
      </MemoryRouter>,
    );

    await flush();

    // Sanity: prior chat hydrated into the thread view.
    expect(screen.getByText('Old question')).toBeTruthy();

    // Navigate to /chat (new chat).
    fireEvent.click(screen.getByTestId('nav-btn'));
    await flush();

    // Empty-hero composer must appear.
    expect(screen.getByPlaceholderText(/what do you want to know/i)).toBeTruthy();
    expect(screen.queryByText('Old question')).toBeNull();

    // Submit a fresh message.
    const textarea = screen.getByPlaceholderText(/what do you want to know/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Brand new question' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    await flush();

    // The fix: backend MUST have been called with sessionId=null. If the bug
    // is present, the spy records sessionId=EXISTING_ID — message merged.
    expect(openChatTurnSpy).toHaveBeenCalled();
    const lastCallArgs = openChatTurnSpy.mock.calls[openChatTurnSpy.mock.calls.length - 1][0];
    expect(lastCallArgs.sessionId).toBeNull();
    expect(lastCallArgs.message).toBe('Brand new question');
  });

  it('back-to-back new chats both update the URL to the new session id', async () => {
    // Live-repro of the user-reported merge: after the first new chat completes
    // and the user clicks "New chat" again, the second submission's URL must
    // still rebind to its own /chat/<id> — otherwise the post-done guard in
    // useChatStream strips the entry from the null-pinned page, hiding the
    // assistant reply (which is what the user perceives as "merged").
    const onLoc = vi.fn();
    render(
      <MemoryRouter initialEntries={[`/chat/${EXISTING_ID}`]}>
        <Route path="/chat/:id?" component={ChatThreadPage} />
        <LocationProbe onChange={onLoc} />
        <NavButton to="/chat" />
      </MemoryRouter>,
    );

    await flush();

    // ---- First new chat cycle ----
    fireEvent.click(screen.getByTestId('nav-btn'));
    await flush();

    let ta = screen.getByPlaceholderText(/what do you want to know/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'First new chat' } });
    fireEvent.keyDown(ta, { key: 'Enter', code: 'Enter' });
    await flush();

    pushEvent({ type: 'session_created', data: { id: 'first-new-id' } });
    await flush();
    pushEvent({ type: 'token', data: { delta: 'reply A' } });
    pushEvent({ type: 'done', data: {} });
    closeStream();
    await flush();

    // URL must have replaced to the first new id.
    let lastPath = onLoc.mock.calls[onLoc.mock.calls.length - 1][0];
    expect(lastPath).toBe('/chat/first-new-id');

    // ---- Second new chat cycle (back-to-back) ----
    fireEvent.click(screen.getByTestId('nav-btn'));
    await flush();

    ta = screen.getByPlaceholderText(/what do you want to know/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'Second new chat' } });
    fireEvent.keyDown(ta, { key: 'Enter', code: 'Enter' });
    await flush();

    pushEvent({ type: 'session_created', data: { id: 'second-new-id' } });
    await flush();

    // Backend got two separate sessionId=null requests.
    expect(openChatTurnSpy).toHaveBeenCalledTimes(2);
    expect(openChatTurnSpy.mock.calls[0][0].sessionId).toBeNull();
    expect(openChatTurnSpy.mock.calls[1][0].sessionId).toBeNull();

    // URL must have replaced again to the second new id — this is the
    // assertion that fails with the per-mount replacedRef latch.
    lastPath = onLoc.mock.calls[onLoc.mock.calls.length - 1][0];
    expect(lastPath).toBe('/chat/second-new-id');
  });
});
