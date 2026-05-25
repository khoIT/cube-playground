/**
 * DELETE /debug/cache?game=<id>
 *
 * Clears all response_cache rows for the given game.
 * Owner must have at least one chat_session in the target game (defense-in-depth).
 *
 * Guards:
 *   401 — missing X-Owner-Id
 *   400 — missing ?game=
 *   403 — owner has no sessions in this game
 *   200 — { deleted: <n> }
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { clearForGame } from '../db/response-cache-store.js';
import { extractOwnerId } from './debug-shared.js';

interface DebugCacheClearOptions {
  db: Database.Database;
}

const debugCacheClearRoutes: FastifyPluginAsync<DebugCacheClearOptions> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  fastify.delete<{ Querystring: { game?: string } }>(
    '/debug/cache',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const gameId = (req.query.game ?? '').trim();
      if (!gameId) {
        return reply.status(400).send({ error: 'Missing ?game= query parameter' });
      }

      // Defense-in-depth: owner must have at least one session in this game
      // so arbitrary owners cannot clear another org's cache.
      const hasSession = db
        .prepare(
          `SELECT 1 FROM chat_sessions
           WHERE owner_id = ? AND game_id = ? AND deleted_at IS NULL
           LIMIT 1`,
        )
        .get(ownerId, gameId);

      if (!hasSession) {
        return reply
          .status(403)
          .send({ error: 'No sessions in this game for the requesting owner' });
      }

      const deleted = clearForGame(db, gameId);
      return reply.send({ deleted });
    },
  );
};

export default debugCacheClearRoutes;
