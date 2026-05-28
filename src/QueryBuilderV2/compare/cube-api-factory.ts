/**
 * Thin wrapper around the cubejs() constructor with workspace-aware transport.
 *
 * Exporting this through a dedicated module lets tests stub the factory via
 *   vi.mock('./cube-api-factory', ...)
 * without triggering @cubejs-client/core's module-level side effects
 * (native WebSocket bindings) that crash Node v24 vitest workers when the
 * full module is mocked with vi.mock('@cubejs-client/core').
 */

import cubejs, { HttpTransport } from '@cubejs-client/core';
import type { CubeApi } from '@cubejs-client/core';

function activeWorkspaceId(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('gds-cube:workspace');
  } catch {
    return null;
  }
}

export function makeCubeApi(token: string, apiUrl: string): CubeApi {
  const headers: Record<string, string> = {};
  const wsId = activeWorkspaceId();
  if (wsId) headers['x-cube-workspace'] = wsId;
  return cubejs(token, {
    apiUrl,
    transport: new HttpTransport({ apiUrl, authorization: token, headers }),
  } as Parameters<typeof cubejs>[1]);
}
