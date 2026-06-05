/**
 * POST /api/workspaces/:id/artifact-sweep
 *
 * On-demand sweep that validates all saved artifacts (dashboards, segments,
 * chat artifacts) for the requesting owner against the workspace's live /meta.
 *
 * Body: { live?: boolean }  — live:true enables bounded live probes for chat
 * artifacts (default false; never live-probes dashboards or segments).
 *
 * Responses:
 *   200  { dashboards, segments, chatArtifacts, summary, generatedAt, note? }
 *   400  unknown workspace id
 *   500  unexpected server error (sweep itself is fail-open per artifact)
 */

import type { FastifyInstance } from 'fastify';

import { resolveWorkspace } from '../services/workspaces-config-loader.js';
import { runSweep } from '../services/artifact-validation-sweep.js';
import { getDb } from '../db/sqlite.js';

export default async function artifactSweepRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { id: string };
    Body: { live?: boolean };
  }>('/api/workspaces/:id/artifact-sweep', async (req, reply) => {
    try {
      const workspace = resolveWorkspace(req.params.id);
      if (!workspace) {
        return reply
          .status(400)
          .send({ error: `unknown workspace "${req.params.id}"` });
      }

      const live = req.body?.live === true;
      const result = await runSweep(getDb(), workspace, req.owner, { live });
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, '[artifact-sweep] unexpected error');
      return reply.status(500).send({ error: msg });
    }
  });
}
