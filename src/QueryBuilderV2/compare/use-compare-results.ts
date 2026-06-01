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

import { type CompareMode } from './derive-compare-query';
import { type DataRow, mergeByDimKey, computeOverlap, type MergedRow } from './merge-by-dim-key';
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
  /**
   * Measures absent from the comparison game's schema. Their comparison/delta
   * columns render as N/A instead of crashing the whole comparison query.
   */
  unavailableMeasures: string[];
  /**
   * The comparison returned rows but NONE shared the query's dimension values
   * with the current rows — so nothing pairs up (e.g. comparing a per-`user_id`
   * breakdown across games, whose user populations are disjoint). The UI shows
   * a heads-up instead of silent empty comparison bars.
   */
  noDimensionOverlap: boolean;
  /**
   * Raw rows the comparison query returned. Carried so the pane can render the
   * comparison game's OWN top-N leaderboard side-by-side when the dimensions
   * don't overlap (the left-join `mergedRows` would otherwise drop them).
   */
  comparisonRows: DataRow[];
}

// Minimal CubeApi surface used inside this hook — lets tests pass a stub
// without any vi.mock() module-level mocking (which triggers OOM in Node v24
// forks pool during jsdom setup).
export interface MinimalCubeApi {
  load(query: Query): Promise<ResultSet<Record<string, string | number>>>;
}

export type ApiFactory = (
  token: string,
  apiUrl: string,
  gameId?: string | null,
) => MinimalCubeApi;

/** Set of fully-qualified member names (measures + dimensions) a game exposes. */
export type MemberSet = Set<string>;

/** Fetches the member names available in a game's Cube schema (null on failure). */
export type MetaFetcher = (apiUrl: string, gameId: string) => Promise<MemberSet | null>;

/**
 * Default meta fetcher — hits the workspace-aware proxy `/meta` with the target
 * game header so it returns that game's schema. Returns null on any failure so
 * the caller falls back to running the unfiltered query (best effort).
 */
async function defaultFetchGameMembers(
  apiUrl: string,
  gameId: string,
): Promise<MemberSet | null> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json', 'x-cube-game': gameId };
    try {
      const ws =
        typeof window !== 'undefined' ? window.localStorage.getItem('gds-cube:workspace') : null;
      if (ws) headers['x-cube-workspace'] = ws;
    } catch {
      /* ignore localStorage errors */
    }
    const resp = await fetch(`${apiUrl}/meta?extended=true`, { headers });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    const members: MemberSet = new Set();
    for (const cube of json?.cubes ?? []) {
      for (const m of cube?.measures ?? []) if (m?.name) members.add(m.name);
      for (const d of cube?.dimensions ?? []) if (d?.name) members.add(d.name);
    }
    return members;
  } catch {
    return null;
  }
}

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
  /**
   * Game id of the active (base) query. Used to keep `prev` comparisons scoped
   * to the same game; `game:<id>` mode overrides it with the target game.
   */
  activeGameId: string | null;
  _apiFactory?: ApiFactory | null;
  /** Test override for the game-meta fetcher; production uses the proxy fetch. */
  _metaFetcher?: MetaFetcher | null;
}

/** Result returned by runCompareLoad — matches the resolved portion of CompareResultsState. */
export interface CompareLoadResult {
  mergedRows: MergedRow[];
  compLabel: string;
  unavailableMeasures: string[];
  noDimensionOverlap: boolean;
  comparisonRows: DataRow[];
}

/**
 * Core async logic for compare loading — pure, no React hooks.
 * Exported so unit tests can call it directly without renderHook/jsdom.
 * Throws on failure; caller maps the error to state.
 */
export async function runCompareLoad(
  params: RunCompareLoadParams,
): Promise<CompareLoadResult> {
  const { query, mode, apiUrl, currentToken, currentResultSet, measures, activeGameId, _apiFactory, _metaFetcher } = params;

  const compareQuery = deriveCompareQuery(query, mode);
  if (!compareQuery) {
    throw new Error('Cannot derive comparison for the current date range.');
  }

  const currentRows = extractRows(currentResultSet);
  const dimKeys = dimKeysFromQuery(query);

  // The cube proxy is server-authoritative — it drops the client Authorization
  // header and mints the upstream token from x-cube-workspace + x-cube-game.
  // So game scope rides the header, not the token: 'game:<id>' targets that
  // game; 'prev' stays on the active game.
  const scopeGameId = mode.startsWith('game:') ? mode.slice(5) : activeGameId;
  const gameId = mode.startsWith('game:') ? mode.slice(5) : '';
  const compLabel = compLabelFromMode(mode, gameId);

  // Cross-game scope: the target game's schema may lack some selected measures
  // or dimensions. Running the full query would 500 ("Cube X not found") and
  // wipe out every comparison column. Intersect the query with the target
  // game's meta and compare only what it supports; the rest is reported as
  // unavailable so the UI renders N/A instead of crashing.
  let measuresToCompare = measures;
  let unavailableMeasures: string[] = [];
  let queryToRun = compareQuery as Query;

  if (mode.startsWith('game:') && scopeGameId) {
    const fetchMembers = _metaFetcher ?? defaultFetchGameMembers;
    const members = await fetchMembers(apiUrl, scopeGameId);
    if (members) {
      measuresToCompare = measures.filter((m) => members.has(m));
      unavailableMeasures = measures.filter((m) => !members.has(m));
      queryToRun = {
        ...queryToRun,
        measures: (queryToRun.measures ?? []).filter((m) => members.has(m)),
        dimensions: (queryToRun.dimensions ?? []).filter((d) => members.has(d)),
      };
    }
  }

  // Nothing in the target game to compare against — skip the load (an empty-
  // measures query would itself error) and surface every measure as N/A.
  if (measuresToCompare.length === 0) {
    const merged = mergeByDimKey(currentRows, [], { dimKeys, measures: [] });
    return { mergedRows: merged, compLabel, unavailableMeasures, noDimensionOverlap: false, comparisonRows: [] };
  }

  // Resolve factory lazily — avoids loading @cubejs-client/core at module-
  // collection time which triggers OOM in Node v24 vitest forks pool.
  const factory: ApiFactory = _apiFactory ?? (await import('./cube-api-factory')).makeCubeApi;
  const compApi = factory(currentToken, apiUrl, scopeGameId);

  const compRs = await compApi.load(queryToRun);
  const compRows = extractRows(compRs as ResultSet<Record<string, string | number>>);
  const merged = mergeByDimKey(currentRows, compRows, { dimKeys, measures: measuresToCompare });

  // Heads-up signal: the comparison returned rows but none pair with the current
  // rows on the selected dimensions. Only meaningful when the query HAS
  // dimensions (a measures-only query keys on '' and always pairs).
  const { comparisonRowCount, matchedRowCount } = computeOverlap(currentRows, compRows, dimKeys);
  const noDimensionOverlap =
    dimKeys.length > 0 &&
    currentRows.length > 0 &&
    comparisonRowCount > 0 &&
    matchedRowCount === 0;

  return { mergedRows: merged, compLabel, unavailableMeasures, noDimensionOverlap, comparisonRows: compRows };
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
   * Game id of the active (base) query. Keeps `prev` comparisons scoped to the
   * same game; `game:<id>` mode overrides it with the target game. Game scope
   * is carried by the x-cube-game header (the proxy mints the token), so this
   * must be supplied or the comparison falls back to the default game's data.
   */
  activeGameId: string | null;
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
  unavailableMeasures: [],
  noDimensionOverlap: false,
  comparisonRows: [],
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
    activeGameId = null,
    _apiFactory = null,
  } = input ?? {};

  const [state, setState] = useState<CompareResultsState>({
    mergedRows: null,
    isLoading: false,
    error: null,
    compLabel: mode === 'prev' ? 'Prior period' : '',
    unavailableMeasures: [],
    noDimensionOverlap: false,
    comparisonRows: [],
  });

  // Track current run to cancel stale effects.
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!input) {
      setState(IDLE_STATE);
      return;
    }

    if (!currentResultSet || !apiUrl || !currentToken) {
      setState({ mergedRows: null, isLoading: false, error: null, compLabel: '', unavailableMeasures: [], noDimensionOverlap: false, comparisonRows: [] });
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
        unavailableMeasures: [],
        noDimensionOverlap: false,
        comparisonRows: [],
      });
      return;
    }

    const runId = ++runIdRef.current;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    (async () => {
      try {
        const { mergedRows, compLabel, unavailableMeasures, noDimensionOverlap, comparisonRows } = await runCompareLoad({
          query,
          mode,
          apiUrl,
          currentToken,
          currentResultSet,
          measures,
          activeGameId,
          _apiFactory,
        });

        if (runId !== runIdRef.current) return;
        setState({ mergedRows, isLoading: false, error: null, compLabel, unavailableMeasures, noDimensionOverlap, comparisonRows });
      } catch (err: unknown) {
        if (runId !== runIdRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({
          mergedRows: null,
          isLoading: false,
          error: `Comparison failed: ${msg}`,
          compLabel: '',
          unavailableMeasures: [],
          noDimensionOverlap: false,
          comparisonRows: [],
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
    activeGameId,
    _apiFactory,
    JSON.stringify(query),
    JSON.stringify(measures),
  ]);

  return state;
}
