/**
 * POST /api/profile — pre-save qualitative profile of a candidate cohort.
 *
 * Returns top-k breakdowns over a few dimensions so a producer can answer
 * "who are these people?" before saving a segment. This is intentionally
 * LAZY — never called automatically; the FE triggers it on explicit expand
 * to avoid charging every proposal a multi-query fan-out.
 *
 * HTTP contract:
 *   Request:  { game_id, cube, predicate, dimensions? }
 *   Response: { total, breakdowns, took_ms, approx }
 *   Always HTTP 200 — partial/empty results are graceful degradation, not errors.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCohortProfile } from '../services/cohort-profile-runner.js';
import type { PredicateNode } from '../types/predicate-tree.js';

// Zod schema for the predicate tree leaf node.
const leafNodeSchema: z.ZodType<unknown> = z.object({
  kind: z.literal('leaf'),
  id: z.string(),
  member: z.string(),
  type: z.enum(['string', 'number', 'time', 'boolean']),
  op: z.string(),
  values: z.array(z.unknown()),
});

// Group node references leafNodeSchema recursively.
const groupNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    kind: z.literal('group'),
    id: z.string(),
    op: z.enum(['AND', 'OR']),
    children: z.array(z.union([leafNodeSchema, groupNodeSchema])),
  }),
);

const predicateSchema = z.union([leafNodeSchema, groupNodeSchema]);

const profileBodySchema = z.object({
  game_id: z.string().min(1),
  cube: z.string().min(1),
  predicate: predicateSchema,
  /** Optional explicit list of Cube member names to profile (e.g. 'user_profile.country'). */
  dimensions: z.array(z.string().min(1)).optional(),
});

export default async function cohortProfileRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/profile', async (req, reply) => {
    const parsed = profileBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: parsed.error.message },
      });
    }

    const { game_id, cube, predicate, dimensions } = parsed.data;

    // runCohortProfile is fully best-effort: it never throws; any upstream
    // failure degrades to { total: null, breakdowns: [], approx: true }.
    const result = await runCohortProfile({
      game_id,
      cube,
      predicate: predicate as PredicateNode,
      dimensions,
    });

    return reply.status(200).send(result);
  });
}
