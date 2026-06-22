/**
 * POST /api/distribution — bucketed histogram of a per-user measure over a
 * population, used by the distribution-first cutoff picker.
 *
 * Request is validated strictly; any structural error is a 4xx. Upstream query
 * failures (timeout, no connector, measure not in catalog) always return HTTP
 * 200 with { buckets: null } so the UI can fall back to a plain numeric input.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { computeDistribution } from '../services/measure-distribution.js';
import type { PredicateNode } from '../types/predicate-tree.js';

const bodySchema = z.object({
  game_id: z.string().min(1),
  /**
   * Logical Cube member, e.g. "mf_users.ltv_vnd". Resolved through the
   * segmentable-measures catalog which is also the security allowlist.
   */
  member: z.string().min(1),
  /**
   * Optional predicate tree scoping the population (AND-combined with the
   * catalog entry's defaultPopulation). Accepts any shape — validated at the
   * predicate-to-sql boundary.
   */
  population_predicate: z.unknown().optional(),
  /**
   * Number of buckets. Defaults to 10 (deciles). Clamped to [2, 100] by the
   * service layer.
   */
  buckets: z.number().int().min(2).max(100).optional(),
});

export default async function distributionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/distribution', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: parsed.error.message },
      });
    }

    const { game_id, member, population_predicate, buckets } = parsed.data;

    // HTTP 200 for all upstream failures — the UI must handle buckets:null.
    const result = await computeDistribution({
      game_id,
      member,
      population_predicate: population_predicate as PredicateNode | undefined,
      buckets,
    });

    return result;
  });
}
