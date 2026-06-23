/**
 * Query-param synced tab state for LiveOps sub-hubs.
 *
 * Keeps the active tab in `?tab=` so deep links (e.g. the /liveops/anomalies →
 * /liveops/alerts?tab=inbox redirect) and back/forward navigation land on the
 * right tab. Mirrors the Ops Console's tab-sync logic (OpsConsole/index.tsx) but
 * generic over the hub's tab id union.
 */
import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';

export function useLiveopsTab<T extends string>(
  validIds: readonly T[],
  defaultId: T,
): [T, (next: T) => void] {
  const history = useHistory();
  const location = useLocation();

  const read = React.useCallback(
    (search: string): T => {
      const tab = new URLSearchParams(search).get('tab');
      return tab && (validIds as readonly string[]).includes(tab) ? (tab as T) : defaultId;
    },
    [validIds, defaultId],
  );

  const [active, setActive] = React.useState<T>(() => read(location.search));

  // Sync from a deep-linked / pasted / back-forward ?tab=.
  React.useEffect(() => {
    const fromUrl = read(location.search);
    if (fromUrl !== active) setActive(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const change = React.useCallback(
    (next: T) => {
      setActive(next);
      const params = new URLSearchParams(location.search);
      params.set('tab', next);
      history.replace({ search: params.toString() });
    },
    [history, location.search],
  );

  return [active, change];
}
