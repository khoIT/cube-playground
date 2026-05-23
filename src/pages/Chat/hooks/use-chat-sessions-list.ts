/**
 * useChatSessionsList — fetches the sessions index for a given game.
 * Refetches automatically on gds-cube:chat-session-changed events.
 * Optional `query` param triggers a server-side title search.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { onChatSessionChanged } from '../../../shell/chat-overlay/chat-session-events';
import { getOwnerId } from '../../../api/chat-owner-id';

export interface SessionSummary {
  id: string;
  gameId: string;
  title: string;
  /** ISO timestamp string. */
  createdAt: string;
  /** ISO timestamp string. Falls back to createdAt when missing. */
  updatedAt?: string;
}

// Server payload (chat-service snake_case + epoch ms).
interface RawSessionSummary {
  id: string;
  owner_id?: string;
  game_id: string;
  title: string;
  created_at: number;
  last_turn_at?: number | null;
}

/**
 * Map chat-service's raw payload (snake_case + epoch ms) to the FE shape
 * (camelCase + ISO strings). Without this mapping, downstream relativeTime()
 * calls received `undefined` for createdAt/updatedAt and rendered "NaNd ago".
 */
function normalizeSession(raw: RawSessionSummary): SessionSummary {
  const updatedMs = raw.last_turn_at ?? raw.created_at;
  return {
    id: raw.id,
    gameId: raw.game_id,
    title: raw.title,
    createdAt: new Date(raw.created_at).toISOString(),
    updatedAt: new Date(updatedMs).toISOString(),
  };
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

export function useChatSessionsList(query?: string) {
  const gameId = useActiveGameId();
  const [state, dispatch] = useReducer(reducer, { status: 'idle' });
  const trimmed = (query ?? '').trim();

  const fetchSessions = useCallback(async (signal?: AbortSignal) => {
    dispatch({ type: 'FETCH' });
    try {
      const params = new URLSearchParams({ game: gameId });
      if (trimmed) params.set('q', trimmed);
      const res = await fetch(`/api/chat/sessions?${params.toString()}`, {
        headers: { Accept: 'application/json', 'X-Owner-Id': getOwnerId() },
        signal,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        dispatch({ type: 'ERROR', error: msg });
        return;
      }
      const data = await res.json();
      // Server returns { sessions: [...] } or plain array of raw rows.
      const rawList: RawSessionSummary[] = Array.isArray(data) ? data : (data.sessions ?? []);
      dispatch({ type: 'SUCCESS', sessions: rawList.map(normalizeSession) });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }, [gameId, trimmed]);

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
