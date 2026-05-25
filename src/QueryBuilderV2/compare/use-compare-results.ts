/**
 * React hook: runs the current query + its derived comparison query in
 * parallel and merges the results via mergeByDimKey.
 *
 * For 'game:<id>' mode a second CubeApi instance is created on-the-fly using
 * the per-game token fetched from /api/playground/cube-token — same pattern as
 * useCubeTokenBootstrap but scoped to the target game only (we do NOT touch
 * the global SecurityContext token).
 *
 * Exported state shape:
 *   { mergedRows, isLoading, error, compLabel }
 *
 * mergedRows = null when compare is 'off' or comparison is unavailable.
 */

import { useEffect, useRef, useState } from 'react';
import type { Query, ResultSet } from '@cubejs-client/core';

import { cubeTokenClient } from '../../api/cube-token-client';
import { type CompareMode } from './derive-compare-query';
import { type DataRow, mergeByDimKey, type MergedRow } from './merge-by-dim-key';
import { deriveCompareQuery } from './derive-compare-query';

// cube-api-factory is intentionally NOT statically imported here.
// A top-level import would cause @cubejs-client/core (which has native
// WebSocket bindings) to load at module-collection time, crashing Node v24
// vitest workers via OOM during jsdom environment setup.
// Instead we resolve it lazily inside runCompareLoad when _apiFactory is omitted.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompareResultsState {
  mergedRows: MergedRow[] | null;
  isLoading: boolean;
  error: string | null;
  /** Human-readable label for the comparison series, used in chart legends. */
  compLabel: string;
}

// Minimal CubeApi surface used inside this hook — lets tests pass a stub
// without any vi.mock() module-level mocking (which triggers OOM in Node v24
// forks pool during jsdom setup).
export interface MinimalCubeApi {
  load(query: Query): Promise<ResultSet<Record<string, string | number>>>;
}

export type ApiFactory = (token: string, apiUrl: string) => MinimalCubeApi;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function extractRows(rs: ResultSet<Record<string, string | number>>): DataRow[] {
  try {
    // @ts-expect-error — SDK types don't expose loadResponse directly
    return (rs.loadResponse?.results?.[0]?.data ?? []) as DataRow[];
  } catch {
    return [];
  }
}

function dimKeysFromQuery(query: Query): string[] {
  const dims = query.dimensions ?? [];
  const timeDimKeys = (query.timeDimensions ?? [])
    .filter((td) => !!td.granularity)
    .map((td) => `${td.dimension}.${td.granularity}`);
  return [...dims, ...timeDimKeys];
}

function compLabelFromMode(mode: CompareMode, gameId: string): string {
  if (mode === 'prev') return 'Prior period';
  return `Game: ${gameId}`;
}

// ---------------------------------------------------------------------------
// Exported pure async core — tested directly (no React, no jsdom needed)
// ---------------------------------------------------------------------------

export interface RunCompareLoadParams {
  query: Query;
  mode: CompareMode;
  apiUrl: string;
  currentToken: string;
  currentResultSet: ResultSet<any>;
  measures: string[];
  _apiFactory?: ApiFactory | null;
}

/** Result returned by runCompareLoad — matches the resolved portion of CompareResultsState. */
export interface CompareLoadResult {
  mergedRows: MergedRow[];
  compLabel: string;
}

/**
 * Core async logic for compare loading — pure, no React hooks.
 * Exported so unit tests can call it directly without renderHook/jsdom.
 * Throws on failure; caller maps the error to state.
 */
export async function runCompareLoad(
  params: RunCompareLoadParams,
): Promise<CompareLoadResult> {
  const { query, mode, apiUrl, currentToken, currentResultSet, measures, _apiFactory } = params;

  const compareQuery = deriveCompareQuery(query, mode);
  if (!compareQuery) {
    throw new Error('Cannot derive comparison for the current date range.');
  }

  const currentRows = extractRows(currentResultSet);
  const dimKeys = dimKeysFromQuery(query);

  // Resolve factory lazily — avoids loading @cubejs-client/core at module-
  // collection time which triggers OOM in Node v24 vitest forks pool.
  const factory: ApiFactory = _apiFactory ?? (await import('./cube-api-factory')).makeCubeApi;
  let compApi = factory(currentToken, apiUrl);

  if (mode.startsWith('game:')) {
    const targetGameId = mode.slice(5);
    const resp = await cubeTokenClient.get(targetGameId);
    if (resp?.token) {
      compApi = factory(resp.token, apiUrl);
    }
    // If token fetch fails we proceed with currentToken — comparison may be
    // approximate but we don't hard-fail.
  }

  const compRs = await compApi.load(compareQuery as Query);
  const compRows = extractRows(compRs as ResultSet<Record<string, string | number>>);
  const merged = mergeByDimKey(currentRows, compRows, { dimKeys, measures });

  const gameId = mode.startsWith('game:') ? mode.slice(5) : '';
  return { mergedRows: merged, compLabel: compLabelFromMode(mode, gameId) };
}

// ---------------------------------------------------------------------------
// Hook input + idle state
// ---------------------------------------------------------------------------

interface UseCompareResultsInput {
  query: Query;
  mode: CompareMode;
  /** Current apiUrl (from AppContext). */
  apiUrl: string | null;
  /** Current token for the active game. */
  currentToken: string | null;
  /** Result set of the current (non-comparison) query that is already loaded. */
  currentResultSet: ResultSet<any> | null;
  /** The measures present in the current query — used as delta keys. */
  measures: string[];
  /**
   * Optional override for the CubeApi factory — used in tests to avoid
   * loading @cubejs-client/core at module-collection time (Node v24 OOM).
   * Production callers omit this; runCompareLoad lazy-imports makeCubeApi().
   */
  _apiFactory?: ApiFactory | null;
}

const IDLE_STATE: CompareResultsState = {
  mergedRows: null,
  isLoading: false,
  error: null,
  compLabel: '',
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Pass `null` when compare is off — hook returns idle state immediately
 * without any network calls.
 */
export function useCompareResults(
  input: UseCompareResultsInput | null,
): CompareResultsState {
  // Destructure with stable fallbacks so hook call count stays constant
  // regardless of whether input is null (Rules of Hooks).
  const {
    query = {} as Query,
    mode = 'prev',
    apiUrl = null,
    currentToken = null,
    currentResultSet = null,
    measures = [],
    _apiFactory = null,
  } = input ?? {};

  const [state, setState] = useState<CompareResultsState>({
    mergedRows: null,
    isLoading: false,
    error: null,
    compLabel: mode === 'prev' ? 'Prior period' : '',
  });

  // Track current run to cancel stale effects.
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!input) {
      setState(IDLE_STATE);
      return;
    }

    if (!currentResultSet || !apiUrl || !currentToken) {
      setState({ mergedRows: null, isLoading: false, error: null, compLabel: '' });
      return;
    }

    // Quick synchronous check — avoids kicking off async work if query is invalid.
    const compareQuery = deriveCompareQuery(query, mode);
    if (!compareQuery) {
      setState({
        mergedRows: null,
        isLoading: false,
        error: 'Cannot derive comparison for the current date range.',
        compLabel: '',
      });
      return;
    }

    const runId = ++runIdRef.current;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    (async () => {
      try {
        const { mergedRows, compLabel } = await runCompareLoad({
          query,
          mode,
          apiUrl,
          currentToken,
          currentResultSet,
          measures,
          _apiFactory,
        });

        if (runId !== runIdRef.current) return;
        setState({ mergedRows, isLoading: false, error: null, compLabel });
      } catch (err: unknown) {
        if (runId !== runIdRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({
          mergedRows: null,
          isLoading: false,
          error: `Comparison failed: ${msg}`,
          compLabel: '',
        });
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    input != null,
    mode,
    apiUrl,
    currentToken,
    currentResultSet,
    _apiFactory,
    JSON.stringify(query),
    JSON.stringify(measures),
  ]);

  return state;
}
