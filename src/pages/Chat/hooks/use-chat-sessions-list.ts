/**
 * useChatSessionsList — fetches the sessions index for a given game.
 * Refetches automatically on gds-cube:chat-session-changed events.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { onChatSessionChanged } from '../../../shell/chat-overlay/chat-session-events';

export interface SessionSummary {
  id: string;
  gameId: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; sessions: SessionSummary[] }
  | { status: 'error'; error: string };

type Action =
  | { type: 'FETCH' }
  | { type: 'SUCCESS'; sessions: SessionSummary[] }
  | { type: 'ERROR'; error: string };

function reducer(_: State, action: Action): State {
  switch (action.type) {
    case 'FETCH':   return { status: 'loading' };
    case 'SUCCESS': return { status: 'loaded', sessions: action.sessions };
    case 'ERROR':   return { status: 'error', error: action.error };
    default:        return _;
  }
}

export function useChatSessionsList() {
  const gameId = useActiveGameId();
  const [state, dispatch] = useReducer(reducer, { status: 'idle' });

  const fetchSessions = useCallback(async (signal?: AbortSignal) => {
    dispatch({ type: 'FETCH' });
    try {
      const res = await fetch(`/api/chat/sessions?game=${encodeURIComponent(gameId)}`, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        dispatch({ type: 'ERROR', error: msg });
        return;
      }
      const data = await res.json();
      // Server returns { sessions: [...] } or plain array.
      const sessions: SessionSummary[] = Array.isArray(data) ? data : (data.sessions ?? []);
      dispatch({ type: 'SUCCESS', sessions });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }, [gameId]);

  // Initial fetch.
  useEffect(() => {
    const controller = new AbortController();
    fetchSessions(controller.signal);
    return () => controller.abort();
  }, [fetchSessions]);

  // Refetch on session-changed events.
  useEffect(() => {
    const unsub = onChatSessionChanged(() => fetchSessions());
    return unsub;
  }, [fetchSessions]);

  return {
    sessions: state.status === 'loaded' ? state.sessions : [],
    isLoading: state.status === 'loading',
    error: state.status === 'error' ? state.error : null,
    refetch: fetchSessions,
  };
}
