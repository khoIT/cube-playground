/**
 * Business-metrics registry HTTP surface.
 *
 *   GET  /api/business-metrics       — full registry (sorted by id).
 *   GET  /api/business-metrics/:id   — one metric or 404.
 *   POST /api/business-metrics       — Zod-validate body, atomic write,
 *                                       refresh cache, return 201 + canonicalised body.
 *
 * Loader cache must already be hydrated (see `loadAll` call in `index.ts`).
 */

import type { FastifyInstance } from 'fastify';

import { BusinessMetricSchema } from '../types/business-metric.js';
import {
  getAll,
  getById,
  writeMetric,
} from '../services/business-metrics-loader.js';
import { resolveTrustForGame } from '../services/metric-trust-resolver.js';

export default async function businessMetricsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Optional `?game=<id>` query param: when present, trust is downgraded to
  // `draft` for any metric whose formula refs don't resolve against the
  // game's /meta. Omit the param to get the registry with declared trust
  // (kept for backwards-compat with callers that don't have a game context).
  app.get<{ Querystring: { game?: string } }>(
    '/api/business-metrics',
    async (req) => {
      const metrics = getAll();
      const adjusted = await resolveTrustForGame(metrics, req.query.game ?? null);
      return { metrics: adjusted };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { game?: string } }>(
    '/api/business-metrics/:id',
    async (req, reply) => {
      const metric = getById(req.params.id);
      if (!metric) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `metric "${req.params.id}" not found` },
        });
      }
      const [adjusted] = await resolveTrustForGame(
        [metric],
        req.query.game ?? null,
      );
      return adjusted ?? metric;
    },
  );

  app.post('/api/business-metrics', async (req, reply) => {
    const parsed = BusinessMetricSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'invalid body',
          issues: parsed.error.issues,
        },
      });
    }

    try {
      await writeMetric(parsed.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: { code: 'WRITE_FAILED', message },
      });
    }

    return reply.status(201).send(parsed.data);
  });
}
