/**
 * Data hooks for the /dev/chat-audit triage UI.
 * Types live in use-debug-api-types.ts to keep this file under 200 LOC.
 * All requests include X-Owner-Id; ownership enforced server-side.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { chatHeaders } from '../../api/chat-auth-headers';
import type {
  AsyncState,
  DebugSession,
  DebugSessionDetail,
  DebugTurnDetail,
  SdkEvent,
} from './use-debug-api-types';

// Re-export types so consumers only need one import path.
export type {
  AsyncState,
  DebugSession,
  DebugSessionDetail,
  DebugTurn,
  DebugTurnDetail,
  LlmCall,
  ToolInvocation,
  SdkEvent,
  PermissionDecision,
  TurnAnnotation,
  AnnotationFlag,
  SearchHit,
  SearchPage,
} from './use-debug-api-types';

// Re-export phase-04 hooks.
export { useTurnAnnotation, useSetTurnAnnotation, useDeleteTurnAnnotation } from './use-turn-annotation';
export { useDebugSearch } from './use-debug-search';

function authHeaders(): Record<string, string> {
  return chatHeaders();
}

// ---------------------------------------------------------------------------
// useDebugSessions — list sessions for a game, with optional search
// ---------------------------------------------------------------------------

export function useDebugSessions(
  { game, q, scope, owner, hideSynthetic }: { game: string; q: string; scope?: 'mine' | 'all'; owner?: string; hideSynthetic?: boolean },
  refreshTick = 0,
): AsyncState<DebugSession[]> {
  const [state, setState] = useState<AsyncState<DebugSession[]>>({ data: null, error: null, isLoading: false });

  useEffect(() => {
    if (!game) return;
    const controller = new AbortController();
    setState({ data: null, error: null, isLoading: true });

    // 500 ≫ the largest per-owner-per-game bucket so a single user's list is
    // never truncated; the header count comes from the owners endpoint, which
    // is exact regardless.
    const params = new URLSearchParams({ game, limit: '500' });
    if (q) params.set('q', q);
    // Admin audit scope — the server 403s unless the verified role is admin.
    if (scope === 'all') params.set('scope', 'all');
    // Pin the audit to one owner (admin only; server ignores it otherwise).
    if (owner) params.set('owner', owner);
    // Hide eval/test/bot sessions (server ignores when an owner is pinned).
    if (hideSynthetic) params.set('hideSynthetic', '1');

    fetch(`/api/chat/debug/sessions?${params.toString()}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<DebugSession[]>;
      })
      .then((data) => setState({ data, error: null, isLoading: false }))
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setState({ data: null, error: err.message, isLoading: false });
      });

    return () => controller.abort();
  }, [game, q, scope, owner, hideSynthetic, refreshTick]);

  return state;
}

// ---------------------------------------------------------------------------
// useDebugSessionOwners — distinct owners + counts for the admin user filter
// ---------------------------------------------------------------------------

export interface DebugSessionOwner {
  ownerId: string;
  label: string | null;
  count: number;
}

/**
 * Admin-only: lists chat owners with a session count for the active game.
 * Powers the user-filter dropdown and the exact per-user / total counts in the
 * audit header. With `hideSynthetic`, eval/test/bot owners are excluded so the
 * dropdown matches the hidden-by-default list. Skips fetching unless `enabled`
 * (i.e. the caller is an admin) to avoid a guaranteed 403.
 */
export function useDebugSessionOwners(
  { game, enabled, hideSynthetic }: { game: string; enabled: boolean; hideSynthetic?: boolean },
  refreshTick = 0,
): AsyncState<DebugSessionOwner[]> {
  const [state, setState] = useState<AsyncState<DebugSessionOwner[]>>({ data: null, error: null, isLoading: false });

  useEffect(() => {
    if (!game || !enabled) { setState({ data: null, error: null, isLoading: false }); return; }
    const controller = new AbortController();
    setState({ data: null, error: null, isLoading: true });

    const params = new URLSearchParams({ game });
    // Match the session list's hidden-by-default synthetic filter.
    if (hideSynthetic) params.set('hideSynthetic', '1');
    fetch(`/api/chat/debug/session-owners?${params.toString()}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<DebugSessionOwner[]>;
      })
      .then((data) => setState({ data, error: null, isLoading: false }))
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setState({ data: null, error: err.message, isLoading: false });
      });

    return () => controller.abort();
  }, [game, enabled, hideSynthetic, refreshTick]);

  return state;
}

// ---------------------------------------------------------------------------
// useDebugSession — session detail + augmented turn list
// ---------------------------------------------------------------------------

/**
 * Fetch a single debug session. Pass `refreshTick` to force a re-fetch after
 * a restore operation without changing the session id.
 */
export function useDebugSession(id: string | null, refreshTick = 0): AsyncState<DebugSessionDetail> {
  const [state, setState] = useState<AsyncState<DebugSessionDetail>>({ data: null, error: null, isLoading: false });

  useEffect(() => {
    if (!id) { setState({ data: null, error: null, isLoading: false }); return; }
    const controller = new AbortController();
    setState({ data: null, error: null, isLoading: true });

    fetch(`/api/chat/debug/sessions/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<DebugSessionDetail>;
      })
      .then((data) => setState({ data, error: null, isLoading: false }))
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setState({ data: null, error: err.message, isLoading: false });
      });

    return () => controller.abort();
  }, [id, refreshTick]); // refreshTick forces re-fetch after restore

  return state;
}

// ---------------------------------------------------------------------------
// useRestoreSession — POST /sessions/:id/restore, then signals refresh
// ---------------------------------------------------------------------------

/**
 * Returns a mutator that POSTs to restore a soft-deleted session.
 * `onSuccess` callback lets the parent refresh its session list.
 */
export function useRestoreSession(onSuccess?: () => void): {
  restore: (id: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
} {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      onSuccess?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [onSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  return { restore, isLoading, error };
}

// ---------------------------------------------------------------------------
// usePurgeSession — DELETE /debug/sessions/:id (hard-purge a soft-deleted session)
// ---------------------------------------------------------------------------

/**
 * Returns a mutator that DELETEs a soft-deleted session permanently.
 * Server returns 409 if the session is still live; surface that to the caller.
 * `onSuccess` callback lets the parent refresh its session list.
 */
export function usePurgeSession(onSuccess?: (id: string) => void): {
  purge: (id: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
} {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const purge = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/debug/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      onSuccess?.(id);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [onSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  return { purge, isLoading, error };
}

// ---------------------------------------------------------------------------
// useDebugTurn — per-turn llm_calls + tool_invocations
// ---------------------------------------------------------------------------

export function useDebugTurn(turnId: string | null): AsyncState<DebugTurnDetail> {
  const [state, setState] = useState<AsyncState<DebugTurnDetail>>({ data: null, error: null, isLoading: false });

  useEffect(() => {
    if (!turnId) { setState({ data: null, error: null, isLoading: false }); return; }
    const controller = new AbortController();
    setState({ data: null, error: null, isLoading: true });

    fetch(`/api/chat/debug/turns/${encodeURIComponent(turnId)}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<DebugTurnDetail>;
      })
      .then((data) => setState({ data, error: null, isLoading: false }))
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setState({ data: null, error: err.message, isLoading: false });
      });

    return () => controller.abort();
  }, [turnId]);

  return state;
}

// ---------------------------------------------------------------------------
// useDebugRawEvents — cursor-paginated sdk_events, lazy (caller triggers load)
// ---------------------------------------------------------------------------

interface RawEventsState {
  events: SdkEvent[];
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
  loadMore: () => void;
}

export function useDebugRawEvents(turnId: string | null): RawEventsState {
  const [events, setEvents] = useState<SdkEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const loadingRef = useRef(false);

  // Reset when turnId changes
  useEffect(() => {
    setEvents([]); setNextCursor(null); setHasMore(false);
    setError(null); setIsLoading(false); loadingRef.current = false;
  }, [turnId]);

  const loadMore = useCallback(() => {
    if (!turnId || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({ cursor: String(nextCursor ?? 0), limit: '200' });
    fetch(`/api/chat/debug/turns/${encodeURIComponent(turnId)}/raw?${params.toString()}`, {
      headers: authHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<{ events: SdkEvent[]; nextCursor: number | null }>;
      })
      .then(({ events: newEvents, nextCursor: nc }) => {
        setEvents((prev) => [...prev, ...newEvents]);
        setNextCursor(nc);
        setHasMore(nc !== null);
        setIsLoading(false);
        loadingRef.current = false;
      })
      .catch((err: Error) => {
        setError(err.message);
        setIsLoading(false);
        loadingRef.current = false;
      });
  }, [turnId, nextCursor]);

  return { events, hasMore, isLoading, error, loadMore };
}
