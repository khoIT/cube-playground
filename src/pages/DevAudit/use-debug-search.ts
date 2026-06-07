/**
 * useDebugSearch — debounced cross-turn search hook.
 *
 * When `q` is empty the hook returns an idle state (no fetch).
 * Cursor-paginated; caller can call `loadMore` to fetch the next page.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { chatHeaders } from '../../api/chat-auth-headers';
import type { SearchHit } from './use-debug-api-types';

export type { SearchHit };

function authHeaders(): Record<string, string> {
  return chatHeaders();
}

export interface SearchState {
  results: SearchHit[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

export interface SearchOptions {
  game?: string;
  starredOnly?: boolean;
  limit?: number;
}

/**
 * Fetch the first page when `q` changes; accumulate pages on `loadMore`.
 * Resets accumulated results when `q` or `opts` change.
 */
export function useDebugSearch(q: string, opts: SearchOptions = {}): SearchState {
  const [results, setResults] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  // Reset when query or game changes
  useEffect(() => {
    setResults([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    loadingRef.current = false;

    if (!q.trim()) return;

    const controller = new AbortController();
    setIsLoading(true);
    loadingRef.current = true;

    const params = new URLSearchParams({ q: q.trim() });
    if (opts.game) params.set('game', opts.game);
    if (opts.starredOnly) params.set('starred', '1');
    if (opts.limit) params.set('limit', String(opts.limit));

    fetch(`/api/chat/debug/search?${params.toString()}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<{ results: SearchHit[]; nextCursor: string | null }>;
      })
      .then(({ results: hits, nextCursor }) => {
        setResults(hits);
        setCursor(nextCursor);
        setHasMore(nextCursor !== null);
        setIsLoading(false);
        loadingRef.current = false;
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setIsLoading(false);
        loadingRef.current = false;
      });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, opts.game, opts.starredOnly]);

  const loadMore = useCallback(() => {
    if (!q.trim() || !cursor || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({ q: q.trim(), cursor });
    if (opts.game) params.set('game', opts.game);
    if (opts.starredOnly) params.set('starred', '1');
    if (opts.limit) params.set('limit', String(opts.limit));

    fetch(`/api/chat/debug/search?${params.toString()}`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<{ results: SearchHit[]; nextCursor: string | null }>;
      })
      .then(({ results: hits, nextCursor }) => {
        setResults((prev) => [...prev, ...hits]);
        setCursor(nextCursor);
        setHasMore(nextCursor !== null);
        setIsLoading(false);
        loadingRef.current = false;
      })
      .catch((err: Error) => {
        setError(err.message);
        setIsLoading(false);
        loadingRef.current = false;
      });
  }, [q, cursor, opts.game, opts.starredOnly, opts.limit]);

  return { results, isLoading, error, hasMore, loadMore };
}
