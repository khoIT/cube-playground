/**
 * useDebugCachedQueriesSearch — fetches /debug/search/cached?q= for the Search tab
 * Cached queries mode.
 *
 * Mirrors the useDebugSearch pattern: fires when q is non-empty (or when game
 * changes), aborts on q/game change. Non-paginated — backend returns top N rows.
 */

import { useState, useEffect } from 'react';
import { chatHeaders } from '../../api/chat-auth-headers';
import type { CachedQueryHit } from './use-debug-api-types';

function authHeaders(): Record<string, string> {
  return chatHeaders();
}

export interface CachedQueriesSearchState {
  results: CachedQueryHit[];
  isLoading: boolean;
  error: string | null;
}

export function useDebugCachedQueriesSearch(
  q: string,
  game?: string,
): CachedQueriesSearchState {
  const [results, setResults] = useState<CachedQueryHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResults([]);
    setError(null);

    const controller = new AbortController();
    setIsLoading(true);

    // Empty query → default affordance: top 10 cached queries (endpoint orders
    // by hit_count DESC on empty filter). Otherwise the full search list (20).
    const trimmed = q.trim();
    const params = new URLSearchParams({ limit: trimmed ? '20' : '10' });
    if (trimmed) params.set('q', trimmed);
    if (game) params.set('game', game);

    fetch(`/api/chat/debug/search/cached?${params.toString()}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<{ results: CachedQueryHit[] }>;
      })
      .then(({ results: hits }) => {
        setResults(hits);
        setIsLoading(false);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setIsLoading(false);
      });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, game]);

  return { results, isLoading, error };
}
