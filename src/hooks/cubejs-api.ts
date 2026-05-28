import { useMemo } from 'react';
import cubejs, { HttpTransport } from '@cubejs-client/core';

import { useWorkspaceContext } from '../components/workspace-context';

/**
 * Cube SDK factory that forwards the active workspace id on every request.
 *
 * Re-keys on workspace change so the underlying HttpTransport is rebuilt
 * with the new header — preventing stale `/load` and `/sql` calls from
 * being routed to the previous workspace's Cube backend.
 */
export function useCubejsApi(apiUrl: string | null, token: string | null) {
  const { workspaceId } = useWorkspaceContext();
  return useMemo(() => {
    if (!token || !apiUrl || token === 'undefined') {
      return null;
    }

    const headers: Record<string, string> = {};
    if (workspaceId) headers['x-cube-workspace'] = workspaceId;

    // Cast because @cubejs-client/core@1.6.46 types omit `transport` from
    // CubeApiOptions even though the runtime accepts it. The transport pattern
    // is the supported way to inject custom headers per request.
    return cubejs(token, {
      apiUrl,
      transport: new HttpTransport({
        apiUrl,
        authorization: token,
        headers,
      }),
    } as Parameters<typeof cubejs>[1]);
  }, [apiUrl, token, workspaceId]);
}
