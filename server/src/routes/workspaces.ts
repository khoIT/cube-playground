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
import { computeWorkspaceReadiness } from '../services/workspace-readiness.js';
import { getDb } from '../db/sqlite.js';

export default async function workspacesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/workspaces', async () => {
    return { workspaces: listWorkspacesPublic() };
  });

  // GET /api/workspaces/:id/readiness
  //   200 { workspace, games[], coverage, artifacts }
  //   400 unknown workspace id
  //   500 unexpected
  // owner comes from the standard X-Owner-Id header (per Phase 4 contract).
  app.get<{ Params: { id: string } }>(
    '/api/workspaces/:id/readiness',
    async (req, reply) => {
      try {
        const report = await computeWorkspaceReadiness(
          getDb(),
          req.params.id,
          req.owner,
        );
        return reply.send(report);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('unknown workspace')) {
          return reply.status(400).send({ error: msg });
        }
        req.log.error({ err }, '[workspaces] readiness failed');
        return reply.status(500).send({ error: msg });
      }
    },
  );
}
