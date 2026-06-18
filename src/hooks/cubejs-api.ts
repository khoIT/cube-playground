import { useEffect, useMemo } from 'react';
import cubejs from '@cubejs-client/core';

import { useWorkspaceContext } from '../components/workspace-context';
import { useActiveGameId } from '../components/Header/use-game-context';
import { cubeProxyAuthorization } from '../auth/auth-storage';
import { deriveCubeSource, CUBE_SOURCE_HEADER } from '../api/cube-query-source';
import { ResilientHttpTransport } from '../api/resilient-cube-transport';

/**
 * Cube SDK factory that forwards the active workspace + game on every request.
 *
 * Re-keys on workspace/game change so the underlying HttpTransport is rebuilt
 * with the new header — preventing stale `/load` and `/sql` calls from being
 * routed to the previous workspace's Cube backend.
 *
 * X-Cube-Game is required on the proxy path for minted-auth workspaces
 * (local Cube): the proxy mints a per-game JWT keyed by this header so
 * Cube's repositoryFactory picks the right schema. Without it, local /load
 * calls return errors / wrong-schema results even when /meta looks fine.
 *
 * `gameOverride` pins the X-Cube-Game header to a specific game regardless of
 * the global game selector — used by the per-member 360 page, which must query
 * its segment's game even if the header dropdown points elsewhere.
 */
export function useCubejsApi(apiUrl: string | null, token: string | null, gameOverride?: string | null) {
  const { workspaceId } = useWorkspaceContext();
  const activeGameId = useActiveGameId();
  const gameId = gameOverride !== undefined && gameOverride !== null ? gameOverride : activeGameId;
  // Which surface owns this client — re-keys the transport on navigation so the
  // query-telemetry source reflects the page actually running the query.
  const source = deriveCubeSource();

  // AbortController keyed on the IDENTITY deps only (NOT source). Its signal is
  // wired into the transport so in-flight /load, /sql and /meta abort when this
  // controller is torn down — but ONLY on a genuine workspace/game/token change
  // or component unmount, never on plain navigation. That distinction matters:
  // `source` changes on every route change, and several pages (Segments, Build,
  // Catalog) stay MOUNTED (display:none) when you switch tabs. If the abort
  // tracked `source`, switching to Chat would cancel a still-wanted Segments/
  // Care query mid-flight. Keeping the controller off `source` lets those
  // queries finish in the background so results are ready on return.
  const controller = useMemo(
    () => new AbortController(),
    [apiUrl, token, workspaceId, gameId],
  );

  const api = useMemo(() => {
    if (!token || !apiUrl || token === 'undefined') {
      return null;
    }

    const headers: Record<string, string> = {};
    if (workspaceId) headers['x-cube-workspace'] = workspaceId;
    if (gameId) headers['x-cube-game'] = gameId;
    if (source) headers[CUBE_SOURCE_HEADER] = source;

    // Cast because @cubejs-client/core@1.6.46 types omit `transport` from
    // CubeApiOptions even though the runtime accepts it. The transport pattern
    // is the supported way to inject custom headers per request.
    return cubejs(token, {
      apiUrl,
      transport: new ResilientHttpTransport({
        apiUrl,
        // App JWT so the proxy attributes query telemetry to the logged-in user.
        authorization: cubeProxyAuthorization(token),
        headers,
        // Reused across source/navigation rebuilds; aborts only on unmount or a
        // real workspace/game/token switch (see the controller memo + effect).
        signal: controller.signal,
      }),
    } as Parameters<typeof cubejs>[1]);
  }, [apiUrl, token, workspaceId, gameId, source, controller]);

  // Abort this client's in-flight queries when the controller is superseded by a
  // workspace/game/token change (stale → cancel) or the component unmounts. Does
  // NOT fire on navigation, since `controller` doesn't depend on `source`.
  useEffect(() => () => controller.abort(), [controller]);

  return api;
}
