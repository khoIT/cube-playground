/**
 * GET /api/monetization/payer-tiers?game=<id>
 * GET /api/monetization/cohort-ltv?game=<id>
 * GET /api/monetization/sku-performance?game=<id>&limit=<n>
 *
 * Aggregate-only monetization deep-dive endpoints (no per-user PII).
 * Input: `game` must be a non-empty string matching a known game.
 * Error handling: Cube failures → 502; missing params → 400.
 */

import type { FastifyInstance } from 'fastify';
import { isKnownGame } from '../services/games-config-loader.js';
import {
  fetchPayerTierDistribution,
  fetchCohortLtv,
  fetchSkuPerformance,
} from '../services/monetization-deepdive.js';

export default async function monetizationDeepdiveRoutes(app: FastifyInstance): Promise<void> {
  /** Validate the `game` query param — shared across all three endpoints. */
  function resolveGame(q: Record<string, string | undefined>): string | null {
    const game = q.game?.trim();
    if (!game) return null;
    if (!isKnownGame(game)) return null;
    return game;
  }

  app.get('/api/monetization/payer-tiers', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const game = resolveGame(q);
    if (!game) {
      return reply.status(400).send({ error: '`game` query param required and must be a known game' });
    }
    try {
      return await fetchPayerTierDistribution(game);
    } catch (err) {
      app.log.error({ err, game }, '[monetization] fetchPayerTierDistribution failed');
      return reply.status(502).send({ error: `Cube query failed: ${(err as Error).message}` });
    }
  });

  app.get('/api/monetization/cohort-ltv', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const game = resolveGame(q);
    if (!game) {
      return reply.status(400).send({ error: '`game` query param required and must be a known game' });
    }
    try {
      return await fetchCohortLtv(game);
    } catch (err) {
      app.log.error({ err, game }, '[monetization] fetchCohortLtv failed');
      return reply.status(502).send({ error: `Cube query failed: ${(err as Error).message}` });
    }
  });

  app.get('/api/monetization/sku-performance', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const game = resolveGame(q);
    if (!game) {
      return reply.status(400).send({ error: '`game` query param required and must be a known game' });
    }
    const limit = Math.min(50, Math.max(5, parseInt(q.limit ?? '20', 10) || 20));
    try {
      return await fetchSkuPerformance(game, limit);
    } catch (err) {
      app.log.error({ err, game }, '[monetization] fetchSkuPerformance failed');
      return reply.status(502).send({ error: `Cube query failed: ${(err as Error).message}` });
    }
  });
}
