/**
 * useMapFocus — the concept map's focus state, backed by the `?focus=` query
 * param so deep-links and back/forward work. The URL is the single source of
 * truth (no divergent local state).
 *
 * The ref parser is imported directly from the Cartographer (Decision V3 — one
 * parser, no fork); only the tiny URL read/write plumbing is local here, since
 * it is page-specific (its own pathname). `history.replace` (not push) keeps
 * focus changes out of the back-stack.
 */
import { useCallback, useMemo } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

import { parseFocusRef } from '../schema-cartographer/cartographer-page';

export function useMapFocus(): [string | null, (next: string | null) => void] {
  const history = useHistory();
  const location = useLocation();

  const value = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('focus');
    return raw ? parseFocusRef(raw) : null;
  }, [location.search]);

  const setFocus = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(location.search);
      if (next) params.set('focus', next);
      else params.delete('focus');
      history.replace({ pathname: location.pathname, search: params.toString() });
    },
    [history, location.pathname, location.search],
  );

  return [value, setFocus];
}
