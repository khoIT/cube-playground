/**
 * Topbar trailing-slot context — lets a page component inject content
 * (e.g. a `+ New segment` CTA) into the topbar between the search input
 * and the avatar. Page calls `useTopbarTrailing(node, deps)`; provider
 * lives in App.tsx and renders the latest node from <Topbar>.
 */
import React from 'react';

export type TrailingContent = React.ReactNode;

interface Ctx {
  node: TrailingContent;
  set: (n: TrailingContent) => void;
}

export const TopbarTrailingContext = React.createContext<Ctx>({
  node: null,
  set: () => {},
});

export function TopbarTrailingProvider({ children }: { children: React.ReactNode }) {
  const [node, setNode] = React.useState<TrailingContent>(null);
  const value = React.useMemo(() => ({ node, set: setNode }), [node]);
  return (
    <TopbarTrailingContext.Provider value={value}>
      {children}
    </TopbarTrailingContext.Provider>
  );
}

/**
 * Register `node` as the topbar's trailing content while the calling page is
 * active. Pages live inside KeepAliveRoute and stay mounted under
 * display:none, so callers MUST pass `active` to gate the registration —
 * otherwise hidden pages overwrite the active page's actions on every render.
 */
export function useTopbarTrailing(
  node: TrailingContent,
  deps: React.DependencyList,
  active: boolean = true,
) {
  const { set } = React.useContext(TopbarTrailingContext);
  React.useEffect(() => {
    if (!active) return;
    set(node);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}
