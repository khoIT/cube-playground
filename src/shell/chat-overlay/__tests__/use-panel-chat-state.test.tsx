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
const resetStreamSpy = vi.fn();
const clearBuffersSpy = vi.fn();

// Mutable stream slice so tests can drive status transitions (e.g. → aborted).
function idleStream() {
  return {
    status: 'idle' as string,
    sessionId: null as string | null,
    turnId: null as string | null,
    currentText: '',
    currentReasoning: '',
    currentArtifacts: [] as unknown[],
    currentCharts: [] as unknown[],
    currentProposals: [] as unknown[],
    currentToolCalls: [] as unknown[],
    disambigOptions: null as unknown,
    sendTurn: sendTurnSpy,
    cancel: cancelSpy,
    clearStreamBuffers: clearBuffersSpy,
    resetStream: resetStreamSpy,
  };
}
let streamSlice = idleStream();
vi.mock('../../../pages/Chat/hooks/use-chat-stream', () => ({
  useChatStream: () => streamSlice,
}));

// useChatSession returns a controllable session value so we can simulate
// the hydration race (stale session lingering after sessionId flips).
let mockSession: { id: string; turns: Array<{ id: string; role: 'user' | 'assistant'; text: string; createdAt: string; proposals?: unknown[] }> } | null = null;
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
  streamSlice = idleStream();
  cancelSpy.mockClear();
  sendTurnSpy.mockClear();
  resetStreamSpy.mockClear();
  clearBuffersSpy.mockClear();
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
    // New chat fully wipes via reset() (not cancel) — cancel now keeps a
    // partial as 'aborted', which the commit effect would re-add post-wipe.
    expect(resetStreamSpy).toHaveBeenCalled();
    // Sanity: re-render with sessionId still null should not re-add anything.
    rerender({ sid: null });
    expect(result.current.displayMessages).toEqual([]);
  });

  it('sendFollowup pushes a user bubble and sends the turn (refine-chip parity)', () => {
    // The docked panel must reach the same refine/follow-up behavior as the
    // main chat page: a chip click sends arbitrary text as a new turn.
    const { result } = renderHook(
      ({ sid }: { sid: string | null }) => usePanelChatState(sid),
      { initialProps: { sid: null } },
    );

    act(() => {
      result.current.sendFollowup('Show this weekly instead');
    });

    expect(result.current.displayMessages).toHaveLength(1);
    expect(result.current.displayMessages[0]).toMatchObject({ role: 'user', text: 'Show this weekly instead' });
    expect(sendTurnSpy).toHaveBeenCalledWith('Show this weekly instead', false, false, false);
  });

  it('renders a segment_proposal section for proposals persisted on a turn', () => {
    // Regression: the side panel previously dropped proposals when mapping
    // persisted turns, so the confirm card never appeared in the panel.
    mockSession = {
      id: 'sess-p',
      turns: [
        { id: 't1', role: 'user', text: 'create a segment', createdAt: '2026-06-21T01:00:00Z' },
        {
          id: 't2',
          role: 'assistant',
          text: 'Proposed.',
          createdAt: '2026-06-21T01:00:01Z',
          proposals: [{ type: 'segment_proposal', name: 'Whales', game_id: 'ptg', cube: 'mf_users' }],
        },
      ],
    };

    const { result } = renderHook(
      ({ sid }: { sid: string | null }) => usePanelChatState(sid),
      { initialProps: { sid: 'sess-p' as string | null } },
    );

    const assistant = result.current.displayMessages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    const hasProposal = assistant?.role === 'assistant'
      && assistant.sections.some((s) => s.type === 'segment_proposal');
    expect(hasProposal).toBe(true);
  });

  it('attaches disambigOptions + selected pin from persisted turns (panel parity)', () => {
    // Regression: the docked panel dropped the choice-chip set when mapping
    // persisted turns, so disambiguation chips never rendered in the panel.
    mockSession = {
      id: 'sess-d',
      turns: [
        { id: 't1', role: 'user', text: 'show revenue', createdAt: '2026-06-21T01:00:00Z' },
        {
          id: 't2',
          role: 'assistant',
          text: 'Which revenue?',
          createdAt: '2026-06-21T01:00:01Z',
          disambig: {
            prompt: 'Which revenue?',
            slot: 'revenue_kind',
            options: [
              { label: 'Gross', pinText: 'gross revenue' },
              { label: 'Net', pinText: 'net revenue' },
            ],
          },
        },
        { id: 't3', role: 'user', text: 'net revenue', createdAt: '2026-06-21T01:00:05Z' },
      ],
    } as typeof mockSession;

    const { result } = renderHook(
      ({ sid }: { sid: string | null }) => usePanelChatState(sid),
      { initialProps: { sid: 'sess-d' as string | null } },
    );

    const assistant = result.current.displayMessages.find((m) => m.id === 't2');
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role === 'assistant') {
      expect(assistant.disambigOptions?.options).toHaveLength(2);
      // The following user turn ("net revenue") matches an option's pinText.
      expect(assistant.disambigSelectedPinText).toBe('net revenue');
    }
  });

  it('keeps committed messages on the null → new-id promotion (no wipe)', () => {
    // session_created promotes a brand-new chat: sessionId flips null → real id.
    // committedMessages already holds the user msg + answer — must not be wiped.
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => usePanelChatState(sid),
      { initialProps: { sid: null } },
    );

    act(() => {
      result.current.setComposerValue('Total revenue');
    });
    act(() => {
      result.current.handleSubmit();
    });
    expect(result.current.displayMessages).toHaveLength(1);

    // session_created → parent re-renders with the freshly minted id.
    rerender({ sid: 'sess-new-1' });

    // The user bubble survives the promotion (would be [] without the guard).
    expect(result.current.displayMessages).toHaveLength(1);
    expect(result.current.displayMessages[0].role).toBe('user');
  });

  it('commits the partial answer when the turn ends in "aborted" (Stop / timeout)', () => {
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => usePanelChatState(sid),
      { initialProps: { sid: null } },
    );

    // Mid-stream: tokens arriving.
    act(() => {
      streamSlice = { ...idleStream(), status: 'streaming', currentText: 'partial answer' };
      rerender({ sid: null });
    });
    // Live preview shows the partial.
    expect(
      result.current.displayMessages.some((m) => m.id === '__streaming__'),
    ).toBe(true);

    // Turn aborts (user Stop or server timeout) — status flips to 'aborted'.
    act(() => {
      streamSlice = { ...idleStream(), status: 'aborted', currentText: 'partial answer' };
      rerender({ sid: null });
    });

    // The partial is committed (not dropped) and buffers cleared.
    const committed = result.current.displayMessages.filter((m) => m.id !== '__streaming__');
    const assistant = committed.find((m) => m.role === 'assistant');
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role === 'assistant') {
      expect(assistant.sections.some((s) => s.type === 'text' && s.text === 'partial answer')).toBe(true);
    }
    expect(clearBuffersSpy).toHaveBeenCalled();
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
