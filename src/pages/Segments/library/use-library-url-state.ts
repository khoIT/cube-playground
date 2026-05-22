/**
 * URL-state hook for the Segments Library — keeps the search query, filter
 * pill, and sort selection synced with `?q=...&filter=...&sort=...` on the
 * current location.
 *
 * Reads initial state from the URL on mount, then mirrors any changes back
 * via `history.replace` (debounced for the search query so typing doesn't
 * stack history entries). All defaults are stripped from the URL.
 */

import { useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import type { LibraryFilter } from './library-filter-pills';
import type { LibrarySort } from './library-toolbar';

const FILTERS: ReadonlyArray<LibraryFilter> = ['all', 'live', 'static', 'broken'];
const SORTS: ReadonlyArray<LibrarySort> = ['recent', 'name', 'size'];

const DEFAULT_FILTER: LibraryFilter = 'all';
const DEFAULT_SORT: LibrarySort = 'recent';

interface LibraryUrlState {
  query: string;
  filter: LibraryFilter;
  sort: LibrarySort;
  setQuery: (q: string) => void;
  setFilter: (f: LibraryFilter) => void;
  setSort: (s: LibrarySort) => void;
}

function readInitial(search: string): {
  query: string;
  filter: LibraryFilter;
  sort: LibrarySort;
} {
  const sp = new URLSearchParams(search);
  const rawFilter = sp.get('filter');
  const rawSort = sp.get('sort');
  return {
    query: sp.get('q') ?? '',
    filter: (FILTERS as readonly string[]).includes(rawFilter ?? '')
      ? (rawFilter as LibraryFilter)
      : DEFAULT_FILTER,
    sort: (SORTS as readonly string[]).includes(rawSort ?? '')
      ? (rawSort as LibrarySort)
      : DEFAULT_SORT,
  };
}

export function useLibraryUrlState(): LibraryUrlState {
  const history = useHistory();
  const location = useLocation();
  const [state, setState] = useState(() => readInitial(location.search));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push state → URL whenever local state changes (debounced).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const sp = new URLSearchParams();
      if (state.query) sp.set('q', state.query);
      if (state.filter !== DEFAULT_FILTER) sp.set('filter', state.filter);
      if (state.sort !== DEFAULT_SORT) sp.set('sort', state.sort);
      const qs = sp.toString();
      const next = `${location.pathname}${qs ? `?${qs}` : ''}`;
      if (next !== `${location.pathname}${location.search}`) {
        history.replace(next);
      }
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // location.pathname is needed to scope replaces to the library route.
    // location.search is intentionally NOT a dep — we only react to local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.query, state.filter, state.sort, location.pathname]);

  return {
    query: state.query,
    filter: state.filter,
    sort: state.sort,
    setQuery: (q) => setState((s) => ({ ...s, query: q })),
    setFilter: (f) => setState((s) => ({ ...s, filter: f })),
    setSort: (sort) => setState((s) => ({ ...s, sort })),
  };
}
