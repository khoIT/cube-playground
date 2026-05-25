/**
 * GET /debug/search/cached?q=&game=&limit=
 *
 * Searches response_cache rows visible to the requesting owner.
 * Owner-scoping: owner must have at least one live session in the cache row's game.
 *
 * Guards:
 *   401 — missing X-Owner-Id
 *   200 — { results: CachedQuerySearchHit[] }
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { extractOwnerId } from './debug-shared.js';
import { searchCachedQueries } from '../db/response-cache-store.js';

interface DebugSearchCachedOptions {
  db: Database.Database;
}

const debugSearchCachedRoutes: FastifyPluginAsync<DebugSearchCachedOptions> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  fastify.get<{
    Querystring: { q?: string; game?: string; limit?: string };
  }>(
    '/debug/search/cached',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const q = (req.query.q ?? '').trim();
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1), 100);

      const results = searchCachedQueries(db, {
        ownerId,
        q,
        gameId: req.query.game,
        limit,
      });

      return reply.send({ results });
    },
  );
};

export default debugSearchCachedRoutes;
