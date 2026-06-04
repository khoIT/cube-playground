/**
 * useChatSessionsList — fetches the sessions index for a given game.
 * Refetches automatically on gds-cube:chat-session-changed events.
 * Optional `query` param triggers a server-side title search.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { useWorkspaceContext, WORKSPACE_HEADER } from '../../../components/workspace-context';
import { onChatSessionChanged } from '../../../shell/chat-overlay/chat-session-events';
import { chatHeaders } from '../../../api/chat-auth-headers';

export interface SessionSummary {
  id: string;
  gameId: string;
  title: string;
  /** ISO timestamp string. */
  createdAt: string;
  /** ISO timestamp string. Falls back to createdAt when missing. */
  updatedAt?: string;
  /** Sharing state — 'shared' means published to the team. */
  visibility?: 'private' | 'shared';
  /** Owner display name — populated on the "shared with team" listing. */
  ownerLabel?: string | null;
}

// Server payload (chat-service snake_case + epoch ms).
interface RawSessionSummary {
  id: string;
  owner_id?: string;
  game_id: string;
  title: string;
  created_at: number;
  last_turn_at?: number | null;
  visibility?: 'private' | 'shared';
  owner_label?: string | null;
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
    visibility: raw.visibility,
    ownerLabel: raw.owner_label ?? null,
  };
}

type State =
  | { status: 'idle'; sessions: SessionSummary[] }
  | { status: 'loading'; sessions: SessionSummary[] }
  | { status: 'loaded'; sessions: SessionSummary[] }
  | { status: 'error'; error: string; sessions: SessionSummary[] };

type Action =
  | { type: 'FETCH' }
  | { type: 'SUCCESS'; sessions: SessionSummary[] }
  | { type: 'ERROR'; error: string };

// Keep the previous sessions during refetches so the sidebar tray doesn't
// flash to "Loading…" between session-changed notifies. The list is also
// what the user wants to see most of the time, so dropping it mid-refresh
// produced the perceived bug "new chat doesn't show up" — the list was
// briefly empty, then repainted after SUCCESS arrived.
function reducer(prev: State, action: Action): State {
  switch (action.type) {
    case 'FETCH':   return { status: 'loading', sessions: prev.sessions };
    case 'SUCCESS': return { status: 'loaded', sessions: action.sessions };
    case 'ERROR':   return { status: 'error', error: action.error, sessions: prev.sessions };
    default:        return prev;
  }
}

export function useChatSessionsList(query?: string, opts?: { shared?: boolean }) {
  const gameId = useActiveGameId();
  const { workspaceId } = useWorkspaceContext();
  const [state, dispatch] = useReducer(reducer, { status: 'idle', sessions: [] });
  const trimmed = (query ?? '').trim();
  const shared = opts?.shared ?? false;

  const fetchSessions = useCallback(async (signal?: AbortSignal) => {
    dispatch({ type: 'FETCH' });
    try {
      const params = new URLSearchParams({ game: gameId });
      if (trimmed) params.set('q', trimmed);
      const headers: Record<string, string> = chatHeaders({ Accept: 'application/json' });
      if (workspaceId) headers[WORKSPACE_HEADER] = workspaceId;
      // `shared` switches to the cross-owner "shared with team" listing.
      const endpoint = shared ? '/api/chat/sessions/shared' : '/api/chat/sessions';
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        headers,
        // Defeat HTTP/heuristic caching — a freshly-created session must be
        // visible in the next list response, not stale.
        cache: 'no-store',
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
  }, [gameId, trimmed, workspaceId, shared]);

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
    // Always surface the latest known sessions; loading/error states are
    // signalled via the separate flags so the UI can choose to overlay a
    // spinner instead of clearing the list.
    sessions: state.sessions,
    isLoading: state.status === 'loading',
    error: state.status === 'error' ? state.error : null,
    refetch: fetchSessions,
  };
}
