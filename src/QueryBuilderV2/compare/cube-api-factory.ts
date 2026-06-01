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

export function makeCubeApi(
  token: string,
  apiUrl: string,
  gameId?: string | null,
): CubeApi {
  const headers: Record<string, string> = {};
  const wsId = activeWorkspaceId();
  if (wsId) headers['x-cube-workspace'] = wsId;
  // Game scope is server-authoritative: the cube proxy drops the client
  // Authorization header and mints the upstream token from x-cube-workspace +
  // x-cube-game. Without this header the proxy mints a game-less token and
  // cube-dev serves the default game's data — making every comparison series
  // identical to the active game. Forward the target game so the comparison
  // query is scoped to the game it claims to represent.
  if (gameId) headers['x-cube-game'] = gameId;
  return cubejs(token, {
    apiUrl,
    transport: new HttpTransport({ apiUrl, authorization: token, headers }),
  } as Parameters<typeof cubejs>[1]);
}
