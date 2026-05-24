/**
 * Unified /chat → /chat/:id flow test.
 *
 * Verifies the post-consolidation behavior:
 *  1. /chat (no id) renders the centered empty hero, not a thread.
 *  2. Submitting the composer immediately shows the user's message bubble
 *     (the bug that motivated this work — previously the landing page
 *     cleared the input and showed nothing until session_created arrived).
 *  3. On session_created, URL becomes /chat/<new-id> via history.replace,
 *     and the user message survives the URL change (component stays mounted).
 *  4. Side-panel active session store mirrors the route id (cross-surface
 *     sync, one-directional URL → store).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, useLocation } from 'react-router-dom';

// jsdom doesn't implement Element.scrollIntoView; ChatMessageList calls it on
// every mount/update. Stub it before importing the page.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

// ---------------------------------------------------------------------------
// Controllable SSE mock. Tests push events into the queue via `pushEvent`
// then `await flush()` to let the consumer iterator drain.
// ---------------------------------------------------------------------------

type SseEvent = { type: string; data?: any };

const sseQueue: SseEvent[] = [];
let sseResolve: (() => void) | null = null;
let sseDone = false;

function pushEvent(ev: SseEvent) {
  sseQueue.push(ev);
  sseResolve?.();
  sseResolve = null;
}

function closeStream() {
  sseDone = true;
  sseResolve?.();
  sseResolve = null;
}

async function* fakeStream(): AsyncIterable<SseEvent> {
  while (!sseDone || sseQueue.length > 0) {
    if (sseQueue.length === 0) {
      await new Promise<void>((res) => { sseResolve = res; });
    }
    while (sseQueue.length > 0) {
      yield sseQueue.shift()!;
    }
  }
}

vi.mock('../../../api/chat-sse-client', () => ({
  openChatTurn: vi.fn(() => ({
    stream: fakeStream(),
    cancel: vi.fn(),
  })),
}));

// useChatSession should not hit the network in this test.
vi.mock('../hooks/use-chat-session', () => ({
  useChatSession: () => ({ session: null, isLoading: false, refetch: vi.fn() }),
}));

vi.mock('../hooks/use-chat-sessions-list', () => ({
  useChatSessionsList: () => ({ sessions: [], isLoading: false, refetch: vi.fn() }),
}));

vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'ptg',
}));

// Capture setActiveChatSession calls so we can assert cross-surface sync.
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

// Window width hook: pretend we're on a wide screen so the history rail renders.
vi.mock('../hooks/use-window-width', () => ({
  useWindowWidth: () => 1200,
}));

import { ChatThreadPage } from '../chat-thread-page';
import { useChatStreamStore } from '../../../stores/chat-stream-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function LocationProbe({ onChange }: { onChange: (path: string) => void }) {
  const loc = useLocation();
  React.useEffect(() => onChange(loc.pathname), [loc.pathname, onChange]);
  return null;
}

function renderAtChat() {
  const onLoc = vi.fn();
  // Mount the page under a Route that matches BOTH /chat and /chat/:id, so
  // the component stays mounted across the URL replace — same shape as
  // src/index.tsx routes it in production.
  const utils = render(
    <MemoryRouter initialEntries={['/chat']}>
      <Route path="/chat/:id?" component={ChatThreadPage} />
      <LocationProbe onChange={onLoc} />
    </MemoryRouter>,
  );
  return { ...utils, onLoc };
}

async function flush() {
  // Two ticks: one to let the consumer iterator pick up the event, one for
  // React to commit the reducer dispatch.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatThreadPage — unified /chat → /chat/:id flow', () => {
  beforeEach(() => {
    sseQueue.length = 0;
    sseDone = false;
    sseResolve = null;
    setActiveSpy.mockClear();
    // Reset the singleton chat-stream store between tests so state from one
    // test doesn't bleed into the next (e.g. a streaming entry from test 3
    // would silently no-op test 4's startTurn).
    useChatStreamStore.setState({ streams: new Map(), aliases: new Map() });
  });
  afterEach(() => { closeStream(); });

  it('renders the empty hero on /chat (no id)', () => {
    renderAtChat();
    // Empty hero renders the cube wordmark + new "What do you want to know?" placeholder.
    expect(screen.getByPlaceholderText(/what do you want to know/i)).toBeTruthy();
    // History rail removed in favour of sidebar tray + ChatSearchOverlay.
    expect(screen.queryByTestId('chat-history-rail')).toBeNull();
  });

  it('shows the user message bubble immediately on submit (the bug)', async () => {
    renderAtChat();

    const textarea = screen.getByPlaceholderText(/what do you want to know/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Total revenue this month' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await flush();

    // The user's text must be visible in the DOM right after submit, BEFORE
    // any server event arrives. That's the entire point of the fix.
    expect(screen.getByText('Total revenue this month')).toBeTruthy();
  });

  it('replaces URL to /chat/<id> on session_created and preserves the user msg', async () => {
    const { onLoc } = renderAtChat();

    const textarea = screen.getByPlaceholderText(/what do you want to know/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    await flush();

    // Simulate the server emitting session_created.
    pushEvent({ type: 'session_created', data: { id: 'sess-xyz' } });
    await flush();

    // URL must now be /chat/sess-xyz.
    const lastPath = onLoc.mock.calls[onLoc.mock.calls.length - 1][0];
    expect(lastPath).toBe('/chat/sess-xyz');

    // User's message must still be visible (component stayed mounted —
    // critical: if we'd remounted, committedMessages would have been wiped).
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('syncs route id to the active chat session store (cross-surface)', async () => {
    const { onLoc } = renderAtChat();

    const textarea = screen.getByPlaceholderText(/what do you want to know/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Sync test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    await flush();

    pushEvent({ type: 'session_created', data: { id: 'sess-sync' } });
    await flush();

    expect(onLoc.mock.calls[onLoc.mock.calls.length - 1][0]).toBe('/chat/sess-sync');
    // After URL replace, the URL-id → active-session sync effect should fire.
    expect(setActiveSpy).toHaveBeenCalledWith('sess-sync');
  });
});
