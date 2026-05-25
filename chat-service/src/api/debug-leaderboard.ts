/**
 * Skill leaderboard API.
 *
 *   GET /debug/leaderboard/skills?game=<id>&days=<n>
 *
 * Returns { skills: SkillRow[], computedAt: ISOstring }.
 * Owner-scoped via X-Owner-Id header. days clamped [1, 90] in store layer.
 * Registered as a Fastify plugin under the /debug prefix.
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { extractOwnerId } from './debug-shared.js';
import { computeSkillLeaderboard } from '../db/leaderboard-store.js';

interface LeaderboardRouteOptions {
  db: Database.Database;
}

const QuerySchema = z.object({
  game: z.string().min(1).optional(),
  days: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 30))
    .pipe(z.number().int().min(1).max(90)),
});

const debugLeaderboardRoutes: FastifyPluginAsync<LeaderboardRouteOptions> = async (fastify, opts) => {
  const { db } = opts;

  fastify.get<{ Querystring: { game?: string; days?: string } }>(
    '/debug/leaderboard/skills',
    async (req, reply) => {
      const ownerId = extractOwnerId(req.headers as Record<string, string | string[] | undefined>);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });

      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
      }

      const { game, days } = parsed.data;

      const skills = computeSkillLeaderboard(db, {
        ownerId,
        gameId: game,
        days,
      });

      return reply.send({ skills, computedAt: new Date().toISOString() });
    },
  );
};

export default debugLeaderboardRoutes;
