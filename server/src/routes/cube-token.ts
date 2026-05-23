/**
 * Per-game Cube token endpoint.
 *
 *   GET /api/playground/cube-token?game=<id>
 *     200 { token: string | null, source: 'env' | 'minted' | 'fallback' | 'none' }
 *     400 if `game` query is missing
 *     404 if `game` is unknown to gds.config.json
 *
 * The frontend fetches this on every game switch and pushes the result into
 * SecurityContext.saveToken so subsequent Cube /meta and /load requests carry
 * the right `game` claim. `source: 'none'` means no token strategy is
 * configured — the caller should leave the existing token alone.
 */

import type { FastifyInstance } from 'fastify';

import { isKnownGame } from '../services/games-config-loader.js';
import { resolveCubeTokenForGameDetailed } from '../services/resolve-cube-token.js';

interface Query {
  game?: string;
}

export default async function cubeTokenRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Querystring: Query }>('/api/playground/cube-token', async (req, reply) => {
    const game = req.query.game?.trim();
    if (!game) {
      return reply.status(400).send({
        error: { code: 'MISSING_GAME', message: '`game` query parameter is required' },
      });
    }
    if (!isKnownGame(game)) {
      return reply.status(404).send({
        error: { code: 'UNKNOWN_GAME', message: `game "${game}" not in registry` },
      });
    }
    return resolveCubeTokenForGameDetailed(game);
  });
}
