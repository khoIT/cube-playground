/**
 * Thin wrapper around the cubejs() constructor.
 *
 * Exporting this through a dedicated module lets tests stub the factory via
 *   vi.mock('./cube-api-factory', ...)
 * without triggering @cubejs-client/core's module-level side effects
 * (native WebSocket bindings) that crash Node v24 vitest workers when the
 * full module is mocked with vi.mock('@cubejs-client/core').
 */

import cubejs from '@cubejs-client/core';
import type { CubeApi } from '@cubejs-client/core';

export function makeCubeApi(token: string, apiUrl: string): CubeApi {
  return cubejs(token, { apiUrl });
}
