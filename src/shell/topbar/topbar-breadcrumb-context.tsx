/**
 * Topbar breadcrumb override — lets a detail page replace the last
 * crumb's label with the real entity name (e.g. segment.name,
 * metric.label, concept.fqn) once data loads, instead of leaving the
 * route id/slug in the topbar.
 *
 * Mirrors the trailing-slot pattern in topbar-trailing-context. Pages
 * call `useTopbarBreadcrumbOverride(label, deps, active)`; provider
 * lives in App.tsx; the Breadcrumb component reads `label` and swaps
 * the last crumb when present.
 */
import React from 'react';

interface Ctx {
  label: string | null;
  set: (label: string | null) => void;
}

export const TopbarBreadcrumbContext = React.createContext<Ctx>({
  label: null,
  set: () => {},
});

export function TopbarBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [label, setLabel] = React.useState<string | null>(null);
  const value = React.useMemo(() => ({ label, set: setLabel }), [label]);
  return (
    <TopbarBreadcrumbContext.Provider value={value}>
      {children}
    </TopbarBreadcrumbContext.Provider>
  );
}

/**
 * Register `label` as the last topbar crumb while the calling page is
 * active. Pages stay mounted under KeepAliveRoute, so callers MUST pass
 * `active` to gate the registration — otherwise hidden pages overwrite
 * the active page's label.
 */
export function useTopbarBreadcrumbOverride(
  label: string | null,
  deps: React.DependencyList,
  active: boolean = true,
) {
  const { set } = React.useContext(TopbarBreadcrumbContext);
  React.useEffect(() => {
    if (!active) return;
    set(label);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}
