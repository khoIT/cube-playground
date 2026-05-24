/**
 * useChatSession — fetch and cache a full chat session (turns + artifacts).
 *
 * Returns { session, isLoading, error, refetch }.
 * If sessionId is null or 'new', returns empty state immediately (no fetch).
 */
import { useCallback, useEffect, useReducer } from 'react';
import type { ChartArtifact } from '../../../api/chat-sse-client';
import { getOwnerId } from '../../../api/chat-owner-id';
import { onChatSessionChanged } from '../../../shell/chat-overlay/chat-session-events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  toolCalls?: Array<{ id: string; name: string; ok: boolean; ms: number; summary: string }>;
  artifacts?: Array<{
    id: string;
    title: string;
    summary: string;
    deeplinkUrl: string;
    deeplinkVia: 'inline' | 'session-storage';
    source: string;
    payload: unknown;
    query: unknown;
    sourceRef?: { id: string; name?: string };
    /** Optional embedded chart from emit_query_artifact. */
    chart?: ChartArtifact;
  }>;
  /** Standalone charts emitted via emit_chart in this turn. */
  charts?: ChartArtifact[];
}

export interface ChatSession {
  id: string;
  gameId: string;
  ownerId: string;
  createdAt: string;
  turns: ChatTurn[];
  /** UUID of the turn currently running on the server, if any. Surfaced by
   *  Phase 6 so the client can attach a replay stream on refresh. */
  activeTurnId: string | null;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; session: ChatSession }
  | { status: 'error'; error: string };

type Action =
  | { type: 'FETCH' }
  | { type: 'SUCCESS'; session: ChatSession }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH':  return { status: 'loading' };
    case 'SUCCESS': return { status: 'loaded', session: action.session };
    case 'ERROR':  return { status: 'error', error: action.error };
    case 'RESET':  return { status: 'idle' };
    default:       return _state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatSession(sessionId: string | null) {
  const [state, dispatch] = useReducer(reducer, { status: 'idle' });

  const fetch_ = useCallback(async (id: string, signal: AbortSignal) => {
    dispatch({ type: 'FETCH' });
    try {
      const res = await fetch(`/api/chat/sessions/${id}`, {
        headers: { Accept: 'application/json', 'X-Owner-Id': getOwnerId() },
        signal,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        dispatch({ type: 'ERROR', error: msg });
        return;
      }
      // Server returns `{ session: { id, owner_id, game_id, created_at, ... },
      // turns: [...] }` with snake_case fields. Flatten + camelCase here so
      // downstream code can rely on `session.id`/`session.turns` as the
      // ChatSession type promises.
      const raw = (await res.json()) as {
        session: { id: string; owner_id: string; game_id: string; created_at: number | string };
        turns: ChatTurn[];
        activeTurnId?: string | null;
      };
      const session: ChatSession = {
        id: raw.session.id,
        ownerId: raw.session.owner_id,
        gameId: raw.session.game_id,
        createdAt: typeof raw.session.created_at === 'number'
          ? new Date(raw.session.created_at).toISOString()
          : raw.session.created_at,
        turns: raw.turns,
        activeTurnId: raw.activeTurnId ?? null,
      };
      dispatch({ type: 'SUCCESS', session });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }, []);

  useEffect(() => {
    if (!sessionId || sessionId === 'new') {
      dispatch({ type: 'RESET' });
      return;
    }
    const controller = new AbortController();
    fetch_(sessionId, controller.signal);
    return () => controller.abort();
  }, [sessionId, fetch_]);

  const refetch = useCallback(() => {
    if (!sessionId || sessionId === 'new') return;
    const controller = new AbortController();
    fetch_(sessionId, controller.signal);
  }, [sessionId, fetch_]);

  // Reconcile DB-authoritative turns into this view whenever the chat-stream
  // store notifies that a turn finished for our session. The store fires this
  // window event in its dispatch loop finally block (see chat-stream-store.ts).
  useEffect(() => {
    if (!sessionId || sessionId === 'new') return;
    return onChatSessionChanged((changedId) => {
      if (changedId === sessionId) refetch();
    });
  }, [sessionId, refetch]);

  return {
    session: state.status === 'loaded' ? state.session : null,
    isLoading: state.status === 'loading',
    error: state.status === 'error' ? state.error : null,
    refetch,
  };
}
