/**
 * Tests for ChatLandingPage:
 *   1. Session row click navigates to /chat/:id
 *   2. Composer submit calls openChatTurn with sessionId: null + correct message + game
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { Router } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSessions = [
  { id: 'sess-1', gameId: 'ptg', title: 'Daily revenue query', createdAt: '2026-05-23T10:00:00Z' },
  { id: 'sess-2', gameId: 'ptg', title: 'Top campaigns ROAS',  createdAt: '2026-05-22T09:00:00Z' },
];

vi.mock('../hooks/use-chat-sessions-list', () => ({
  useChatSessionsList: () => ({
    sessions: mockSessions,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'ptg',
}));

// Async generator that emits session_created then done.
function makeStream(sessionId: string) {
  async function* gen() {
    yield { type: 'session_created' as const, data: { id: sessionId } };
    yield { type: 'done' as const, data: {} };
  }
  return gen();
}

const mockOpenChatTurn = vi.fn();

vi.mock('../../../api/chat-sse-client', () => ({
  openChatTurn: (opts: unknown) => mockOpenChatTurn(opts),
}));

vi.mock('../hooks/use-window-width', () => ({
  useWindowWidth: () => 1280, // always wide so rail renders
}));

import { ChatLandingPage } from '../chat-landing-page';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  const history = createMemoryHistory({ initialEntries: ['/chat'] });
  render(
    <Router history={history}>
      <ChatLandingPage />
    </Router>,
  );
  return { history };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatLandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the history rail with session rows', () => {
    renderPage();
    expect(screen.getByTestId('chat-history-rail')).toBeTruthy();
    expect(screen.getByTestId('session-row-sess-1')).toBeTruthy();
    expect(screen.getByTestId('session-row-sess-2')).toBeTruthy();
  });

  it('clicking a session row navigates to /chat/:id', () => {
    const { history } = renderPage();
    fireEvent.click(screen.getByTestId('session-row-sess-1'));
    expect(history.location.pathname).toBe('/chat/sess-1');
  });

  it('submitting composer calls openChatTurn with sessionId null and navigates on session_created', async () => {
    const newId = 'new-sess-99';
    mockOpenChatTurn.mockReturnValue({
      stream: makeStream(newId),
      cancel: vi.fn(),
    });

    const { history } = renderPage();

    const textarea = screen.getByRole('textbox', { name: /chat message/i });
    fireEvent.change(textarea, { target: { value: 'Show daily revenue' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    expect(mockOpenChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null, message: 'Show daily revenue', game: 'ptg' }),
    );

    await waitFor(() => {
      expect(history.location.pathname).toBe(`/chat/${newId}`);
    });
  });
});
