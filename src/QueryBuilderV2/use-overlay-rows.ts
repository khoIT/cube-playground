/**
 * useOverlayRows — load a combined artifact's OVERLAY query independently and
 * return its rows, so the center chart can merge it with the primary result on
 * the date value AND the Results grid can show it as an extra column. Reuses the
 * compare module's workspace-aware CubeApi factory (NOT its merge — that keys on
 * cube-prefixed members and never matches across cubes). The factory is imported
 * lazily to avoid loading @cubejs-client/core at module-collection time (OOMs
 * Node v24 vitest workers).
 *
 * A module-level result + in-flight cache dedupes identical loads: the center
 * chart and the Results column both mount with the same overlay query, so a
 * shared cache keeps it to ONE Cube /load instead of two.
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

// Shared across hook instances so chart + results grid load the overlay once.
const resultCache = new Map<string, CubeRow[]>();
const inflightCache = new Map<string, Promise<CubeRow[]>>();

function extractRows(rs: ResultSet<Record<string, string | number>>): CubeRow[] {
  try {
    // @ts-expect-error — SDK types don't expose loadResponse directly
    return (rs.loadResponse?.results?.[0]?.data ?? []) as CubeRow[];
  } catch {
    return [];
  }
}

/** Load the overlay rows for `key`, sharing an in-flight promise across callers. */
function loadShared(
  key: string,
  overlayQuery: Query,
  apiUrl: string,
  token: string,
  gameId: string | null,
  signal: AbortSignal,
): Promise<CubeRow[]> {
  const cached = resultCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = inflightCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const { makeCubeApi } = await import('./compare/cube-api-factory');
    const api = makeCubeApi(token, apiUrl, gameId, signal);
    const rs = await api.load(overlayQuery);
    const rows = extractRows(rs as ResultSet<Record<string, string | number>>);
    resultCache.set(key, rows);
    return rows;
  })();
  inflightCache.set(key, promise);
  promise.finally(() => {
    if (inflightCache.get(key) === promise) inflightCache.delete(key);
  });
  return promise;
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

    const cached = resultCache.get(key);
    if (cached) {
      setState({ rows: cached, isLoading: false, error: null });
      return;
    }

    const controller = new AbortController();
    setState({ rows: null, isLoading: true, error: null });

    loadShared(key, overlayQuery, apiUrl, token, gameId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setState({ rows, isLoading: false, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ rows: null, isLoading: false, error: err instanceof Error ? err.message : 'overlay load failed' });
      });

    return () => controller.abort();
  }, [overlayQuery, apiUrl, token, gameId]);

  return state;
}
