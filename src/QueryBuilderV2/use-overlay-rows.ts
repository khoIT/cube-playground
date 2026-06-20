/**
 * useOverlayRows — load a combined artifact's OVERLAY query independently and
 * return its rows, so the center chart can merge it with the primary result on
 * the date value. Reuses the compare module's workspace-aware CubeApi factory
 * (NOT its merge — that keys on cube-prefixed members and never matches across
 * cubes). The factory is imported lazily to avoid loading @cubejs-client/core
 * at module-collection time (OOMs Node v24 vitest workers).
 */

import { useEffect, useRef, useState } from 'react';
import type { Query, ResultSet } from '@cubejs-client/core';
import type { CubeRow } from '../charts/merge-on-date-value';

interface OverlayRowsState {
  rows: CubeRow[] | null;
  isLoading: boolean;
  error: string | null;
}

const IDLE: OverlayRowsState = { rows: null, isLoading: false, error: null };

function extractRows(rs: ResultSet<Record<string, string | number>>): CubeRow[] {
  try {
    // @ts-expect-error — SDK types don't expose loadResponse directly
    return (rs.loadResponse?.results?.[0]?.data ?? []) as CubeRow[];
  } catch {
    return [];
  }
}

/**
 * Loads `overlayQuery` once per (query, apiUrl, token, gameId). Returns idle
 * state when `overlayQuery` is null (the non-combined path). A superseded or
 * unmounted effect aborts its in-flight load.
 */
export function useOverlayRows(
  overlayQuery: Query | null,
  apiUrl: string | null,
  token: string | null,
  gameId: string | null,
): OverlayRowsState {
  const [state, setState] = useState<OverlayRowsState>(IDLE);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!overlayQuery || !apiUrl || !token) {
      keyRef.current = null;
      setState(IDLE);
      return;
    }
    // Key includes the token so a re-auth (new token, same query) reloads
    // rather than short-circuiting on the prior load.
    const key = JSON.stringify({ q: overlayQuery, apiUrl, gameId, token });
    if (keyRef.current === key) return; // already loaded this exact overlay
    keyRef.current = key;

    const controller = new AbortController();
    setState({ rows: null, isLoading: true, error: null });

    (async () => {
      try {
        const { makeCubeApi } = await import('./compare/cube-api-factory');
        const api = makeCubeApi(token, apiUrl, gameId, controller.signal);
        const rs = await api.load(overlayQuery);
        if (controller.signal.aborted) return;
        setState({ rows: extractRows(rs as ResultSet<Record<string, string | number>>), isLoading: false, error: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ rows: null, isLoading: false, error: err instanceof Error ? err.message : 'overlay load failed' });
      }
    })();

    return () => controller.abort();
  }, [overlayQuery, apiUrl, token, gameId]);

  return state;
}
