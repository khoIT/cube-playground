/**
 * Regression tests for the "New chat" reset path.
 *
 * Two bugs were caught:
 *
 * 1. Hydration race — when sessionId flips X → null, useChatSession's
 *    internal RESET dispatches in a later effect tick, so the `session`
 *    value briefly remains the previously loaded one. The hydration effect
 *    in usePanelChatState would then re-fire (hydratedRef was just reset
 *    to false) and re-hydrate the just-cleared committedMessages. Fix:
 *    guard hydration with `session.id === sessionId`.
 *
 * 2. Pre-creation case — user submits in a brand-new chat (sessionId still
 *    null), then clicks + before session_created arrives. setSessionId(null)
 *    is a no-op (was already null), so the sessionId-change effect never
 *    fires and the locally-pushed user bubble stays on screen. Fix: expose
 *    an explicit resetChat() that runs regardless of sessionId state.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the heavy hooks usePanelChatState pulls in.
// ---------------------------------------------------------------------------

vi.mock('../../../components/Header/use-game-context', () => ({
  useActiveGameId: () => 'ptg',
}));

const cancelSpy = vi.fn();
const sendTurnSpy = vi.fn();
vi.mock('../../../pages/Chat/hooks/use-chat-stream', () => ({
  useChatStream: () => ({
    status: 'idle',
    sessionId: null,
    currentText: '',
    currentReasoning: '',
    currentArtifacts: [],
    currentCharts: [],
    currentToolCalls: [],
    sendTurn: sendTurnSpy,
    cancel: cancelSpy,
    clearStreamBuffers: vi.fn(),
  }),
}));

// useChatSession returns a controllable session value so we can simulate
// the hydration race (stale session lingering after sessionId flips).
let mockSession: { id: string; turns: Array<{ id: string; role: 'user' | 'assistant'; text: string; createdAt: string }> } | null = null;
vi.mock('../../../pages/Chat/hooks/use-chat-session', () => ({
  useChatSession: (_sessionId: string | null) => ({
    session: mockSession,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { usePanelChatState } from '../use-panel-chat-state';

beforeEach(() => {
  mockSession = null;
  cancelSpy.mockClear();
  sendTurnSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePanelChatState — New chat reset', () => {
  it('resetChat wipes committedMessages even when sessionId is already null', () => {
    // Pre-creation scenario: sessionId stays null, user submits, then clicks +
    // before session_created arrives.
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => usePanelChatState(sid),
      { initialProps: { sid: null } },
    );

    // Simulate the locally-pushed user bubble from handleSubmit.
    act(() => {
      result.current.setComposerValue('Total revenue this month');
    });
    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.displayMessages).toHaveLength(1);
    expect(result.current.displayMessages[0].role).toBe('user');

    // Click + while sessionId still null.
    act(() => {
      result.current.resetChat();
    });

    expect(result.current.displayMessages).toEqual([]);
    expect(result.current.firstUserMessage).toBeNull();
    expect(result.current.composerValue).toBe('');
    expect(cancelSpy).toHaveBeenCalled();
    // Sanity: re-render with sessionId still null should not re-add anything.
    rerender({ sid: null });
    expect(result.current.displayMessages).toEqual([]);
  });

  it('does not re-hydrate cleared messages when session value is stale', () => {
    // Hydration race scenario: parent flips sessionId from "sess-x" → null;
    // useChatSession briefly retains the previous session's data.
    mockSession = {
      id: 'sess-x',
      turns: [
        { id: 't1', role: 'user', text: 'Old question', createdAt: '2026-05-23T19:00:00Z' },
        { id: 't2', role: 'assistant', text: 'Old answer', createdAt: '2026-05-23T19:00:01Z' },
      ],
    };

    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => usePanelChatState(sid),
      { initialProps: { sid: 'sess-x' as string | null } },
    );

    // Hydration should have populated committedMessages from the loaded session.
    expect(result.current.displayMessages.length).toBeGreaterThanOrEqual(2);

    // Flip sessionId to null but leave mockSession at "sess-x" — simulating the
    // race where useChatSession hasn't dispatched its RESET yet.
    rerender({ sid: null });

    // Without the session.id === sessionId guard, the hydration effect would
    // re-fire with stale `session` and re-populate committedMessages.
    expect(result.current.displayMessages).toEqual([]);
  });
});
