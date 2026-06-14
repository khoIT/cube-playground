/**
 * Reproduction: navigating away to an artifact (the /build playground) mid-turn
 * and returning to /chat/:id must keep the "Stop generating" button visible
 * while the turn is still streaming.
 *
 * The chat-stream store is a singleton that keeps the SSE loop alive across
 * unmount, so a re-mounted /chat/:id view should resolve the same streaming
 * slice (status + turnId) and re-render the cancel affordance.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Switch, useHistory } from 'react-router-dom';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

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
    while (sseQueue.length > 0) yield sseQueue.shift()!;
  }
}

vi.mock('../../../api/chat-sse-client', () => ({
  openChatTurn: vi.fn(() => ({ stream: fakeStream(), cancel: vi.fn() })),
}));

// Existing-session shape: session resolves with an in-flight activeTurnId so
// the auto-replay-attach path matches production after a navigate-back. The
// `null` branch (new chat, no id yet) returns no session.
vi.mock('../hooks/use-chat-session', () => ({
  useChatSession: (id: string | null) =>
    id
      ? {
          session: { id, turns: [], activeTurnId: 'turn-1' },
          isLoading: false,
          forbidden: false,
          refetch: vi.fn(),
        }
      : { session: null, isLoading: false, forbidden: false, refetch: vi.fn() },
}));
vi.mock('../hooks/use-chat-sessions-list', () => ({
  useChatSessionsList: () => ({ sessions: [], isLoading: false, refetch: vi.fn() }),
}));
vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'ptg',
}));
vi.mock('../../../shell/chat-overlay/use-active-chat-session', () => ({
  setActiveChatSession: vi.fn(),
  useActiveChatSession: () => [null, vi.fn()],
  getActiveChatSession: () => null,
}));
vi.mock('../../../shell/sidebar/recent-items-store', () => ({ pushRecent: vi.fn() }));
vi.mock('../../../shell/chat-overlay/chat-session-events', () => ({
  notifyChatSessionChanged: vi.fn(),
  onChatSessionChanged: vi.fn(() => () => {}),
}));
vi.mock('../hooks/use-window-width', () => ({ useWindowWidth: () => 1200 }));
vi.mock('../../../api/chat-cancel-turn', () => ({
  cancelTurn: vi.fn(async () => ({ ok: true })),
}));

import { ChatThreadPage } from '../chat-thread-page';
import { useChatStreamStore } from '../../../stores/chat-stream-store';

let nav: ReturnType<typeof useHistory> | null = null;
function NavCapture() {
  nav = useHistory();
  return null;
}

function renderApp(initial = '/chat/sess-xyz') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <NavCapture />
      <Switch>
        <Route path="/build" render={() => <div data-testid="build-page">build</div>} />
        <Route path="/chat/:id?" component={ChatThreadPage} />
      </Switch>
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

describe('ChatThreadPage — cancel button survives artifact navigation', () => {
  beforeEach(() => {
    sseQueue.length = 0;
    sseDone = false;
    sseResolve = null;
    useChatStreamStore.setState({ streams: new Map(), aliases: new Map() });
  });
  afterEach(() => { closeStream(); });

  it('keeps the Stop generating button after navigate-to-artifact-and-back', async () => {
    renderApp();

    // Submit a turn on the existing session.
    const textarea = screen.getByPlaceholderText(/what do you want to know/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Total revenue' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    await flush();

    // Server registers the turn + starts streaming.
    pushEvent({ type: 'turn_started', data: { turnId: 'turn-1' } });
    pushEvent({ type: 'token', data: { delta: 'Working…' } });
    await flush();

    expect(screen.queryByTestId('turn-cancel-button')).not.toBeNull();

    // Click an artifact → navigate to the playground (chat page unmounts).
    act(() => { nav!.push('/build?x=1'); });
    await flush();
    expect(screen.queryByTestId('build-page')).not.toBeNull();
    expect(screen.queryByTestId('turn-cancel-button')).toBeNull();

    // Stream is still live — more tokens arrive while away.
    pushEvent({ type: 'token', data: { delta: ' more' } });
    await flush();

    // Click back to the chat thread (chat page re-mounts).
    act(() => { nav!.push('/chat/sess-xyz'); });
    await flush();

    // The turn is still streaming → the button MUST be back.
    expect(screen.queryByTestId('turn-cancel-button')).not.toBeNull();
  });

  it('keeps the button for a NEW chat (session created this session) after navigate-and-back', async () => {
    renderApp('/chat');

    const textarea = screen.getByPlaceholderText(/what do you want to know/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Total revenue' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    await flush();

    // Server creates the session, registers the turn, starts streaming.
    pushEvent({ type: 'session_created', data: { id: 'sess-xyz' } });
    pushEvent({ type: 'turn_started', data: { turnId: 'turn-1' } });
    pushEvent({ type: 'token', data: { delta: 'Working…' } });
    await flush();

    expect(screen.queryByTestId('turn-cancel-button')).not.toBeNull();

    // Navigate to artifact (unmount) then back.
    act(() => { nav!.push('/build?x=1'); });
    await flush();
    expect(screen.queryByTestId('turn-cancel-button')).toBeNull();

    pushEvent({ type: 'token', data: { delta: ' more' } });
    await flush();

    act(() => { nav!.push('/chat/sess-xyz'); });
    await flush();

    expect(screen.queryByTestId('turn-cancel-button')).not.toBeNull();
  });
});
