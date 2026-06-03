/**
 * Concept relations endpoint — cross-layer reverse navigation.
 *   GET /api/concepts/:namespace/:id/relations
 *
 * `:id` may contain dots (a cube member like `mf_users.payer_tier`), so the ref
 * is `<namespace>/<id>`. Segment edges are scoped to the caller's active
 * workspace (the real access boundary) so a ref never dereferences a segment
 * outside it.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getRelations } from '../services/concept-reverse-index.js';
import { REF_NAMESPACES } from '../services/trust-mapping.js';

function readGameId(req: FastifyRequest): string | null {
  const raw = req.headers['x-cube-game'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default async function conceptsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { namespace: string; id: string } }>(
    '/api/concepts/:namespace/:id/relations',
    async (req, reply) => {
      const { namespace, id } = req.params;
      if (!(REF_NAMESPACES as readonly string[]).includes(namespace)) {
        return reply.status(400).send({ code: 'bad_request', message: 'unknown namespace' });
      }
      const ref = `${namespace}/${id}`;
      const relations = getRelations(ref, {
        workspaceId: req.workspace.id,
        gameId: readGameId(req),
      });
      if (!relations) return reply.status(400).send({ code: 'bad_request', message: 'malformed ref' });
      return relations;
    },
  );
}
