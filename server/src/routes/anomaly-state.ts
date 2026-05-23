/**
 * Anomaly-state HTTP surface.
 *
 *   GET /api/anomaly-state?game=<id>
 *     → { states: Record<metricId, AnomalyStateRecord>, source: 'detector'|'yaml' }
 *
 * Game param required. Server is the single source of truth so the frontend
 * does not have to re-derive per-game filtering.
 */

import type { FastifyInstance } from 'fastify';

import { getAnomalyStateForGame } from '../services/anomaly-state-store.js';

export default async function anomalyStateRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/anomaly-state', async (req, reply) => {
    const game = (req.query as { game?: string })?.game;
    if (typeof game !== 'string' || game.trim() === '') {
      return reply.status(400).send({ error: 'game query param required' });
    }
    const result = await getAnomalyStateForGame(game.trim());
    return result;
  });
}
