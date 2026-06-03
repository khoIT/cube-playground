import { useMemo } from 'react';
import cubejs, { HttpTransport } from '@cubejs-client/core';

import { useWorkspaceContext } from '../components/workspace-context';
import { useActiveGameId } from '../components/Header/use-game-context';
import { cubeProxyAuthorization } from '../auth/auth-storage';

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
 */
export function useCubejsApi(apiUrl: string | null, token: string | null) {
  const { workspaceId } = useWorkspaceContext();
  const gameId = useActiveGameId();
  return useMemo(() => {
    if (!token || !apiUrl || token === 'undefined') {
      return null;
    }

    const headers: Record<string, string> = {};
    if (workspaceId) headers['x-cube-workspace'] = workspaceId;
    if (gameId) headers['x-cube-game'] = gameId;

    // Cast because @cubejs-client/core@1.6.46 types omit `transport` from
    // CubeApiOptions even though the runtime accepts it. The transport pattern
    // is the supported way to inject custom headers per request.
    return cubejs(token, {
      apiUrl,
      transport: new HttpTransport({
        apiUrl,
        // App JWT so the proxy attributes query telemetry to the logged-in user.
        authorization: cubeProxyAuthorization(token),
        headers,
      }),
    } as Parameters<typeof cubejs>[1]);
  }, [apiUrl, token, workspaceId, gameId]);
}
