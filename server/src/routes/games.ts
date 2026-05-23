/**
 * Game registry endpoint. Reads gds.config.json at server cwd (repo root) and
 * exposes it under /api/playground/games. Public — no secrets in config.
 */

import type { FastifyInstance } from 'fastify';

import { loadGamesConfig } from '../services/games-config-loader.js';

export default async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/playground/games', async () => loadGamesConfig());
}
