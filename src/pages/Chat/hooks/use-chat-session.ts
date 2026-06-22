/**
 * useChatSession — fetch and cache a full chat session (turns + artifacts).
 *
 * Returns { session, isLoading, error, refetch }.
 * If sessionId is null or 'new', returns empty state immediately (no fetch).
 */
import { useCallback, useEffect, useReducer } from 'react';
import type { ChartArtifact } from '../../../api/chat-sse-client';
import type { DisambigOptionsPayload } from '../../../stores/chat-stream-store-actions';
import type { SegmentProposalPayload } from '../../../api/segment-proposal';
import { chatHeaders } from '../../../api/chat-auth-headers';
import { onChatSessionChanged } from '../../../shell/chat-overlay/chat-session-events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  /** Concatenated assistant chain-of-thought captured from live `thinking`
   *  events. Null on user turns and on assistant turns persisted before
   *  reasoning capture shipped (or when served from response cache). */
  reasoning?: string | null;
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
    /** Combined dual-axis artifact: the overlay (right-axis) query, and the
     *  flag that tells "Open in Playground" to write the sibling overlay key.
     *  Without these on the persisted-replay path the overlay is dropped on
     *  reload and the playground renders only the primary metric. */
    overlay?: unknown;
    combined?: boolean;
    /** Game the artifact targets. Carried so "Open in Playground" can pin it in
     *  the deeplink — without it the playground falls back to a possibly-null
     *  active game and the overlay /load goes out game-less (cube 500s). */
    game?: string;
  }>;
  /** Standalone charts emitted via emit_chart in this turn. */
  charts?: ChartArtifact[];
  /** True when this turn was served from the response cache (vs live LLM). */
  cacheHit?: boolean;
  /**
   * Freshness of cached payload — set only when cacheHit=true.
   *   'refreshed' — server re-executed chart queries against live Cube on replay.
   *   'stale'     — cached payload served as-is.
   */
  cacheFreshness?: 'refreshed' | 'stale' | null;
  /** Turn id of the original cached turn this was replayed from (provenance). */
  originalTurnId?: string | null;
  /** Choice-chip set this turn offered (offer_choices / disambiguate_query),
   *  persisted server-side so the chips re-render on reload. Null when none. */
  disambig?: DisambigOptionsPayload | null;
  /** Segment proposals emitted during this turn; re-rendered as confirm cards on reload. */
  proposals?: SegmentProposalPayload[];
  /** Lead takeaway this turn emitted (emit_verdict), re-rendered above the body on reload. */
  verdict?: import('../../../api/chat-sse-client').VerdictData | null;
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
  /** Sharing state — 'shared' means published to the team. */
  visibility: 'private' | 'shared';
  /** Owner display name (for "shared by …" on a non-owner read-only view). */
  ownerLabel: string | null;
  /** True when the caller is NOT the owner (viewing a shared session) — the
   *  composer + owner-only controls must be locked. */
  readOnly: boolean;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; session: ChatSession }
  | { status: 'error'; error: string; httpStatus?: number };

type Action =
  | { type: 'FETCH' }
  | { type: 'SUCCESS'; session: ChatSession }
  | { type: 'ERROR'; error: string; httpStatus?: number }
  | { type: 'RESET' };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH':  return { status: 'loading' };
    case 'SUCCESS': return { status: 'loaded', session: action.session };
    case 'ERROR':  return { status: 'error', error: action.error, httpStatus: action.httpStatus };
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
        headers: chatHeaders({ Accept: 'application/json' }),
        signal,
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        dispatch({ type: 'ERROR', error: msg, httpStatus: res.status });
        return;
      }
      // Server returns `{ session: { id, owner_id, game_id, created_at, ... },
      // turns: [...] }` with snake_case fields. Flatten + camelCase here so
      // downstream code can rely on `session.id`/`session.turns` as the
      // ChatSession type promises.
      const raw = (await res.json()) as {
        session: {
          id: string;
          owner_id: string;
          game_id: string;
          created_at: number | string;
          visibility?: 'private' | 'shared';
          owner_label?: string | null;
        };
        turns: ChatTurn[];
        activeTurnId?: string | null;
        readOnly?: boolean;
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
        visibility: raw.session.visibility ?? 'private',
        ownerLabel: raw.session.owner_label ?? null,
        readOnly: raw.readOnly ?? false,
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
    /** True when the session exists but the caller has no access (403). Drives
     *  the "no access" empty state instead of a generic error. */
    forbidden: state.status === 'error' && state.httpStatus === 403,
    refetch,
  };
}
