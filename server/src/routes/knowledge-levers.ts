/**
 * Genre-aware lever knowledge route.
 *
 * GET /api/knowledge/levers?game=<id>[&gate=off]
 *   Resolves the lever library for a game: selects genre/game-applicable levers,
 *   runs the per-game data-gate against live Cube /meta, joins internal+external
 *   benchmarks, and partitions into { levers, withheld, blindSpots }.
 *
 * Read-only, runs under the service principal (same posture as the care
 * registry — no per-user cube DATA, only /meta member presence). The game is
 * validated against the workspace's known games (resolveGameScope), bounding it
 * to a real game.
 *
 * `gate=off` is a review/debug view that skips the data-gate so the authored
 * library can be inspected without a live warehouse — clearly non-production.
 */

import type { FastifyInstance } from 'fastify';
import { getGameMembers } from '../care/availability.js';
import { resolveGameScope } from '../care/game-scope.js';
import { resolveLeversForGame } from '../knowledge/genre-levers/lever-library-index.js';

export default async function knowledgeLeversRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/knowledge/levers', async (req, reply) => {
    const scope = resolveGameScope(req.workspace, (req.query as { game?: string })?.game);
    if (!scope.ok) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    }
    const game = (req.query as { game: string }).game.trim();
    const skipDataGate = (req.query as { gate?: string })?.gate === 'off';

    // Member set scoped to THIS game's prefix; empty (unreachable /meta) →
    // everything non-blind-spot is withheld (fail-closed), unless gate=off.
    let members = new Set<string>();
    if (!skipDataGate) {
      const ctx = req.buildIntrospectionCtxForGame
        ? req.buildIntrospectionCtxForGame(game)
        : req.cubeCtx;
      const cacheKey = `${req.workspace.id}:${game}`;
      members = await getGameMembers(ctx, scope.gamePrefix, cacheKey);
    }

    const resolution = resolveLeversForGame(game, members, { skipDataGate });

    return {
      ...resolution, // carries game, genre, levers, withheld, blindSpots
      gated: !skipDataGate,
      meta_members: members.size,
      counts: {
        levers: resolution.levers.length,
        withheld: resolution.withheld.length,
        blindSpots: resolution.blindSpots.length,
      },
    };
  });
}
