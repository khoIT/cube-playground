/**
 * useDebugSessionsSearch — fetches /debug/sessions?q= for the Search tab Sessions mode.
 *
 * Mirrors the useDebugSearch pattern: fires when q is non-empty, aborts on
 * q/game change, resets on new query.
 */

import { useState, useEffect } from 'react';
import { chatHeaders } from '../../api/chat-auth-headers';
import type { DebugSession } from './use-debug-api-types';

function authHeaders(): Record<string, string> {
  return chatHeaders();
}

export interface SessionsSearchState {
  results: DebugSession[];
  isLoading: boolean;
  error: string | null;
}

export function useDebugSessionsSearch(
  q: string,
  game?: string,
): SessionsSearchState {
  const [results, setResults] = useState<DebugSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResults([]);
    setError(null);

    if (!q.trim()) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    const params = new URLSearchParams({ q: q.trim(), limit: '50' });
    if (game) params.set('game', game);

    fetch(`/api/chat/debug/sessions?${params.toString()}`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<DebugSession[]>;
      })
      .then((sessions) => {
        setResults(sessions);
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
