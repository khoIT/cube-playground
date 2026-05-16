import { useCallback, useMemo } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

/**
 * Read/write the `?tags=a,b` URL query parameter.
 *
 * - Empty / missing param → empty set.
 * - `toggle(tag)` adds or removes a tag and pushes a history entry (back button
 *   restores the previous selection).
 * - `clear()` removes the param entirely.
 *
 * Designed for the QueryBuilder sidebar so selections survive reloads and are
 * shareable. URL writes preserve all other params (e.g. router-managed state).
 */
export function useSelectedTags(): {
  selectedTags: Set<string>;
  toggle: (tag: string) => void;
  clear: () => void;
} {
  const history = useHistory();
  const location = useLocation();

  const selectedTags = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get('tags');
    if (!raw) return new Set<string>();
    return new Set(raw.split(',').filter(Boolean));
  }, [location.search]);

  const updateUrl = useCallback(
    (next: Set<string>) => {
      const params = new URLSearchParams(location.search);
      if (next.size === 0) {
        params.delete('tags');
      } else {
        params.set('tags', Array.from(next).sort().join(','));
      }
      const qs = params.toString();
      history.push({
        pathname: location.pathname,
        search: qs ? `?${qs}` : '',
        hash: location.hash,
      });
    },
    [history, location.pathname, location.search, location.hash],
  );

  const toggle = useCallback(
    (tag: string) => {
      const next = new Set(selectedTags);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      updateUrl(next);
    },
    [selectedTags, updateUrl],
  );

  const clear = useCallback(() => {
    updateUrl(new Set());
  }, [updateUrl]);

  return { selectedTags, toggle, clear };
}
