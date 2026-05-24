/**
 * Business-metrics registry HTTP surface.
 *
 *   GET   /api/business-metrics            — full registry (sorted by id).
 *   GET   /api/business-metrics/:id        — one metric or 404.
 *   POST  /api/business-metrics            — Zod-validate body, atomic write,
 *                                            refresh cache, return 201 + canonicalised body.
 *   PATCH /api/business-metrics/:id/trust  — flip trust + append to trust_history.
 *                                            Promoting to `certified` requires every
 *                                            formula ref to resolve against the metric's
 *                                            primary game `/meta`.
 *
 * Loader cache must already be hydrated (see `loadAll` call in `index.ts`).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  BusinessMetricSchema,
  TRUST_TIERS,
  type BusinessMetric,
  type TrustHistoryEntry,
} from '../types/business-metric.js';
import {
  getAll,
  getById,
  writeMetric,
} from '../services/business-metrics-loader.js';
import { getDrift, resolveTrustForGame } from '../services/metric-trust-resolver.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { getMeta } from '../services/cube-client.js';
import {
  snapshotFromMeta,
  validateRefs,
  type MetaResponse,
} from '../services/metric-ref-validator.js';

const TrustPatchSchema = z.object({
  trust: z.enum(TRUST_TIERS),
  actor: z.string().min(1).optional(),
  note: z.string().max(280).optional(),
});

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

  app.get<{ Querystring: { game?: string } }>(
    '/api/business-metrics/drift',
    async (req, reply) => {
      const gameId = req.query.game;
      if (!gameId) {
        return reply.status(400).send({
          error: { code: 'GAME_REQUIRED', message: '`game` query param is required' },
        });
      }
      try {
        const drift = await getDrift(getAll(), gameId);
        return drift;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({
          error: { code: 'DRIFT_FAILED', message },
        });
      }
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

  app.patch<{
    Params: { id: string };
    Querystring: { game?: string };
    Body: unknown;
  }>('/api/business-metrics/:id/trust', async (req, reply) => {
    const prev = getById(req.params.id);
    if (!prev) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `metric "${req.params.id}" not found` },
      });
    }

    const parsed = TrustPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'invalid body',
          issues: parsed.error.issues,
        },
      });
    }
    const { trust: target, actor, note } = parsed.data;

    // Promotion to `certified` requires every formula ref to resolve against
    // the metric's primary game /meta. `draft` and `deprecated` are unconditional.
    if (target === 'certified') {
      const gameId = prev.meta?.game_id ?? req.query.game ?? null;
      if (!gameId) {
        return reply.status(400).send({
          error: {
            code: 'GAME_UNKNOWN',
            message:
              'cannot validate refs without a game — set meta.game_id on the metric or pass ?game=',
          },
        });
      }
      const token = resolveCubeTokenForGame(gameId);
      if (!token) {
        return reply.status(400).send({
          error: { code: 'GAME_UNKNOWN', message: `no Cube token for game "${gameId}"` },
        });
      }
      let meta: MetaResponse;
      try {
        meta = (await getMeta(token)) as MetaResponse;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({
          error: { code: 'META_FETCH_FAILED', message },
        });
      }
      const unresolved = validateRefs([prev], snapshotFromMeta(meta));
      if (unresolved.length > 0) {
        return reply.status(400).send({
          error: {
            code: 'REFS_UNRESOLVED',
            message: `metric "${prev.id}" has unresolved refs against /meta for game "${gameId}"`,
            missingRefs: unresolved.map((u) => u.ref),
          },
        });
      }
    }

    const entry: TrustHistoryEntry = {
      trust: target,
      at: new Date().toISOString(),
      ...(actor ? { actor } : {}),
      ...(note ? { note } : {}),
    };

    const next: BusinessMetric = {
      ...prev,
      trust: target,
      meta: {
        ...(prev.meta ?? {}),
        trust_history: [...(prev.meta?.trust_history ?? []), entry],
      },
    };

    try {
      await writeMetric(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: { code: 'WRITE_FAILED', message },
      });
    }

    return reply.status(200).send(next);
  });
}
