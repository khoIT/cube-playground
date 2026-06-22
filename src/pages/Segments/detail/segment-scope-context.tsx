/**
 * Segment detail "population scope" — a non-destructive view filter layered on
 * top of the segment's stored predicate. Today the only sub-scope is "paying
 * users only" (lifetime recharge > 0), driven by `?scope=paying` so the view is
 * shareable and survives reload. The segment definition is never mutated.
 *
 * Read by useSegmentCubeQuery (which appends the `paying_lifetime` cube segment
 * to every card/KPI query when active), so KPIs + Insights + Monitor re-scope
 * with zero per-call wiring. The provider wraps the whole detail view; outside
 * the provider the default is the inert `all` scope, so the hook stays safe in
 * tests and other surfaces.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactElement, ReactNode } from 'react';
import { useHistory, useLocation } from 'react-router-dom';

export type SegmentScope = 'all' | 'paying';

interface SegmentScopeState {
  scope: SegmentScope;
  setScope: (s: SegmentScope) => void;
  /** Whether the paying sub-scope is offered for this segment (cube-gated). */
  available: boolean;
}

const SegmentScopeContext = createContext<SegmentScopeState>({
  scope: 'all',
  setScope: () => {},
  available: false,
});

function readScope(search: string): SegmentScope {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('scope') === 'paying' ? 'paying' : 'all';
}

/**
 * Provider — owns the URL-backed scope state. `available` is passed by the
 * detail view (true only for cubes that model a lifetime-paying segment, i.e.
 * mf_users). When a segment doesn't support the sub-scope we both hide the
 * control AND pin the effective scope to `all` so a stale `?scope=paying`
 * deep-link can't silently filter a cube that has no paying segment.
 */
export function SegmentScopeProvider({
  available,
  children,
}: {
  available: boolean;
  children: ReactNode;
}): ReactElement {
  const location = useLocation();
  const history = useHistory();
  const [scope, setScopeState] = useState<SegmentScope>(() => readScope(location.search));

  // Reflect scope into the URL (shareable deep-link). Drop the param entirely
  // for the default `all` so a clean segment URL has no scope noise.
  useEffect(() => {
    const next = new URLSearchParams(location.search);
    if (scope === 'paying' && available) next.set('scope', 'paying');
    else next.delete('scope');
    const search = next.toString() ? `?${next.toString()}` : '';
    if (search !== location.search) history.replace({ ...location, search });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, available]);

  const setScope = useCallback((s: SegmentScope) => setScopeState(s), []);

  const value = useMemo<SegmentScopeState>(
    () => ({ scope: available ? scope : 'all', setScope, available }),
    [scope, available, setScope],
  );

  return <SegmentScopeContext.Provider value={value}>{children}</SegmentScopeContext.Provider>;
}

export function useSegmentScope(): SegmentScopeState {
  return useContext(SegmentScopeContext);
}
