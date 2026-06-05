/**
 * GET /api/chat/starter-questions — per-(workspace, game) suggested
 * questions for the chat landing page and overlay chips.
 *
 * Headers: `x-cube-game` (required), `X-Cube-Workspace` (defaults 'local',
 * mirroring the turn route). Response is schema-derived only — no owner
 * scoping needed because the set is identical for every user of the game,
 * and no per-user/PII data is read.
 *
 * Never blocks on the LLM: a hard miss pays only the synchronous template
 * pass; refinement settles in the background and shows up on a later fetch.
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import { getOrGenerateStarterQuestions } from '../core/starter-question-service.js';

interface StarterQuestionsRouteOptions {
  db: Database.Database;
}

const starterQuestionsRoutes: FastifyPluginAsync<StarterQuestionsRouteOptions> = async (
  fastify,
  opts,
) => {
  fastify.get('/api/chat/starter-questions', async (req, reply) => {
    const gameRaw = req.headers['x-cube-game'];
    if (typeof gameRaw !== 'string' || !gameRaw.trim()) {
      return reply.status(400).send({ error: 'Missing x-cube-game header' });
    }
    const gameId = gameRaw.trim();

    const wsRaw = req.headers['x-cube-workspace'];
    const workspace =
      typeof wsRaw === 'string' && wsRaw.trim() ? wsRaw.trim() : 'local';

    const response = await getOrGenerateStarterQuestions(opts.db, {
      workspace,
      gameId,
      logger: req.log,
    });
    return reply.send(response);
  });
};

export default starterQuestionsRoutes;
