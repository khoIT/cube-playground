/**
 * POST /api/preview — given a predicate tree + primary cube, return a cohort
 * count estimate, the resolved Cube query, and the generated SQL.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { preview } from '../services/preview-service.js';
import type { PredicateNode } from '../types/predicate-tree.js';

const previewBodySchema = z.object({
  predicate_tree: z.unknown(),
  primary_cube: z.string().min(1),
  /** Cube-level segments scoping the cohort (e.g. mf_users.whales) — the
   *  count must carry them or the editor previews the unsegmented population. */
  cube_segments: z.array(z.string().min(1)).optional(),
});

export default async function previewRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/preview', async (req, reply) => {
    const parsed = previewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    try {
      const result = await preview(
        parsed.data.predicate_tree as PredicateNode,
        parsed.data.primary_cube,
        parsed.data.cube_segments ?? [],
      );
      return result;
    } catch (err) {
      return reply.status(502).send({
        error: { code: 'CUBE_UPSTREAM', message: (err as Error).message },
      });
    }
  });
}
