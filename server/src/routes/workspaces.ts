/**
 * Workspaces registry endpoint.
 *
 *   GET /api/workspaces
 *     200 { workspaces: Array<{ id, label, gameModel, authMode, gamePrefixMap?, isDefault }> }
 *
 * Secret-free projection: cubeApiUrl is NEVER returned (SSRF + leakage guard).
 * Clients use this to render the workspace switcher; switching just sets a
 * header on subsequent requests.
 */

import type { FastifyInstance } from 'fastify';

import { listWorkspacesPublic } from '../services/workspaces-config-loader.js';

export default async function workspacesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/workspaces', async () => {
    return { workspaces: listWorkspacesPublic() };
  });
}
