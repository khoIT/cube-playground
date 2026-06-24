/**
 * Cross-turn search API.
 *
 *   GET /debug/search?q=&game=&starred=&cursor=&limit=
 *
 * Returns { results: SearchHit[], nextCursor: string | null }.
 * Owner-scoped: chat_sessions.owner_id join enforces isolation.
 * Registered as a Fastify plugin under the /debug prefix.
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { extractOwnerId } from './debug-shared.js';
import { searchTurns, listRecentTurns } from '../db/turn-search-store.js';

interface SearchRouteOptions {
  db: Database.Database;
}

const debugSearchRoutes: FastifyPluginAsync<SearchRouteOptions> = async (fastify, opts) => {
  const { db } = opts;

  // GET /debug/search
  fastify.get<{
    Querystring: {
      q?: string;
      game?: string;
      starred?: string;
      cursor?: string;
      limit?: string;
    };
  }>(
    '/debug/search',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const q = (req.query.q ?? '').trim();
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1), 100);
      const starredOnly = req.query.starred === '1' || req.query.starred === 'true';

      // Empty query → default affordance: most-recent turns (no pagination).
      if (!q) {
        const recent = listRecentTurns(db, {
          ownerId,
          gameId: req.query.game,
          limit,
        });
        return reply.send({ results: recent, nextCursor: null });
      }

      const page = searchTurns(db, {
        ownerId,
        q,
        gameId: req.query.game,
        starredOnly,
        cursor: req.query.cursor,
        limit,
      });

      return reply.send(page);
    },
  );
};

export default debugSearchRoutes;
