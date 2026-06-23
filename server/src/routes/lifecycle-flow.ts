/**
 * GET /api/lifecycle-flow?game=<id>
 *
 * Returns the current lifecycle state counts (New / Core / Lapsing / Reactivated /
 * Churned) derived from mf_users via Cube. Transitions are not available because
 * mf_users holds only the current snapshot with no activity history; the response
 * includes a `transitionsUnavailableReason` so the client can render an honest
 * empty-state rather than fabricated flows.
 *
 * Input validation: `game` must be a non-empty string identifying a known game.
 * Error handling: Cube failures propagate as 502; bad input returns 400.
 */

import type { FastifyInstance } from 'fastify';
import { isKnownGame } from '../services/games-config-loader.js';
import { fetchLifecycleFlow } from '../services/lifecycle-flow.js';

export default async function lifecycleFlowRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/lifecycle-flow', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const game = q.game?.trim();

    if (!game) {
      return reply.status(400).send({ error: '`game` query param required' });
    }
    if (!isKnownGame(game)) {
      return reply.status(400).send({ error: `Unknown game: ${game}` });
    }

    try {
      const result = await fetchLifecycleFlow(game);
      return result;
    } catch (err) {
      app.log.error({ err, game }, '[lifecycle-flow] fetchLifecycleFlow failed');
      const message = err instanceof Error ? err.message : 'internal error';
      return reply.status(502).send({ error: `Cube query failed: ${message}` });
    }
  });
}
