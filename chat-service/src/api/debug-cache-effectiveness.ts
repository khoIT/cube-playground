/**
 * GET /debug/cache-effectiveness?game=<id>&days=<n>&topN=<n>&q=<str>
 *
 * Returns cache-effectiveness metrics for the requesting owner.
 * Owner-scoping is enforced in the store layer (JOIN through chat_sessions.owner_id).
 *
 * Guards:
 *   401 — missing X-Owner-Id header
 *   400 — invalid days/topN params
 *   403 — gameId provided but owner has no sessions in that game (defense-in-depth)
 *   200 — CacheEffectivenessResult
 *
 * days clamped [1, 90]; topN clamped [1, 100] (also clamped in store layer).
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { extractOwnerId } from './debug-shared.js';
import { computeCacheEffectiveness } from '../db/cache-effectiveness-store.js';

interface DebugCacheEffectivenessOptions {
  db: Database.Database;
}

const QuerySchema = z.object({
  game: z.string().min(1).optional(),
  days: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 30))
    .pipe(z.number().int().min(1).max(90)),
  topN: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  q: z.string().optional(),
});

const debugCacheEffectivenessRoutes: FastifyPluginAsync<DebugCacheEffectivenessOptions> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  fastify.get<{ Querystring: { game?: string; days?: string; topN?: string; q?: string } }>(
    '/debug/cache-effectiveness',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) {
        return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      }

      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
      }

      const { game, days, topN, q } = parsed.data;

      // Defense-in-depth: when a specific game is requested, verify owner has
      // at least one session in that game. Mirrors debug-cache-clear.ts pattern.
      if (game) {
        const hasSession = db
          .prepare(
            `SELECT 1 FROM chat_sessions
             WHERE owner_id = ? AND game_id = ? AND deleted_at IS NULL
             LIMIT 1`,
          )
          .get(ownerId, game);

        if (!hasSession) {
          return reply.status(403).send({ error: 'No sessions in this game for the requesting owner' });
        }
      }

      const result = computeCacheEffectiveness(db, {
        ownerId,
        gameId: game,
        days,
        topN,
        q,
      });

      return reply.send(result);
    },
  );
};

export default debugCacheEffectivenessRoutes;
