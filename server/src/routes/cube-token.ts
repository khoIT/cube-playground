/**
 * Per-game Cube token endpoint (workspace-aware).
 *
 *   GET /api/playground/cube-token?game=<id>
 *     200 { token: string | null, source: 'env' | 'minted' | 'fallback' | 'none' }
 *     400 if `game` query is missing
 *     404 if `game` is unknown to gds.config.json
 *
 * Workspace is taken from `x-cube-workspace`. `authMode='none'` (prod cube-dev)
 * intentionally returns `{ token: null, source: 'none' }` — the client uses
 * that to skip Authorization header on subsequent Cube calls.
 */

import type { FastifyInstance } from 'fastify';

import { isKnownGame } from '../services/games-config-loader.js';
import { resolveCubeTokenForWorkspace } from '../services/resolve-cube-token.js';

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
    return resolveCubeTokenForWorkspace(req.workspace, game);
  });
}
