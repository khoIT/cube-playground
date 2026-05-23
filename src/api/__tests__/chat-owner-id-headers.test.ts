/**
 * Regression test for the chat owner-id header.
 *
 * Background: useChatSession + useChatSessionsList + session-row-menu +
 * useChatStream.reconnect previously fetched /api/chat/sessions/* without
 * the X-Owner-Id header. The chat-service then 403'd or returned an empty
 * list because the server-side proxy fell back to `anonymous`, which
 * mismatches the actual owner stored on existing sessions.
 *
 * These tests pin the header onto every chat-sessions request path so the
 * regression doesn't sneak back in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const origFetch = global.fetch;

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = origFetch;
  vi.restoreAllMocks();
});

describe('chat owner-id header on /api/chat/sessions/*', () => {
  it('useChatSession sends X-Owner-Id when fetching session detail', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeJsonResponse({ session: { id: 's1' }, turns: [] }),
    );

    // Lazy-import to ensure the localStorage stub is in place before module init.
    const { useChatSession } = await import('../../pages/Chat/hooks/use-chat-session');
    renderHook(() => useChatSession('s1'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Owner-Id']).toBe('dev');
  });

  it('useChatSessionsList sends X-Owner-Id when listing sessions', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeJsonResponse([]));

    // Stub useActiveGameId.
    vi.doMock('../../components/Header/use-game-context', () => ({
      useActiveGameId: () => 'ptg',
    }));
    vi.doMock('../../shell/chat-overlay/chat-session-events', () => ({
      onChatSessionChanged: () => () => {},
    }));

    const { useChatSessionsList } = await import('../../pages/Chat/hooks/use-chat-sessions-list');
    renderHook(() => useChatSessionsList());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Owner-Id']).toBe('dev');
  });

  it('honours a custom owner id stored in localStorage', async () => {
    localStorage.setItem('gds-cube:owner', 'alice');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeJsonResponse({ session: { id: 's1' }, turns: [] }),
    );

    const { useChatSession } = await import('../../pages/Chat/hooks/use-chat-session');
    renderHook(() => useChatSession('s1'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Owner-Id']).toBe('alice');
  });
});
