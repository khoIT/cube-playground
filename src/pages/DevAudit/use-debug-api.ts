/**
 * Data hooks for the /dev/chat-audit triage UI.
 * Types live in use-debug-api-types.ts to keep this file under 200 LOC.
 * All requests include X-Owner-Id; ownership enforced server-side.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getOwnerId } from '../../api/chat-owner-id';
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
} from './use-debug-api-types';

function authHeaders(): Record<string, string> {
  return { 'X-Owner-Id': getOwnerId() };
}

// ---------------------------------------------------------------------------
// useDebugSessions — list sessions for a game, with optional search
// ---------------------------------------------------------------------------

export function useDebugSessions({ game, q }: { game: string; q: string }): AsyncState<DebugSession[]> {
  const [state, setState] = useState<AsyncState<DebugSession[]>>({ data: null, error: null, isLoading: false });

  useEffect(() => {
    if (!game) return;
    const controller = new AbortController();
    setState({ data: null, error: null, isLoading: true });

    const params = new URLSearchParams({ game, limit: '50' });
    if (q) params.set('q', q);

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
  }, [game, q]);

  return state;
}

// ---------------------------------------------------------------------------
// useDebugSession — session detail + augmented turn list
// ---------------------------------------------------------------------------

export function useDebugSession(id: string | null): AsyncState<DebugSessionDetail> {
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
  }, [id]);

  return state;
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
