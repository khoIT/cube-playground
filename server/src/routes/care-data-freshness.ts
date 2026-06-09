/**
 * VIP-care data-freshness route.
 *
 * GET /api/care/data-freshness?game=<id> — `cube → YYYY-MM-DD` for the cubes
 * backing a game's queryable (available/partial) playbooks, so the CS console
 * can stamp each playbook row and the header with the freshest date its data
 * source actually holds. Behaviour marts lag real time; this is what stops a CS
 * agent reading a weeks-old gameplay cohort as today.
 *
 * Kept separate from /api/care/playbooks deliberately: a cold MAX probe on a
 * heavy as-of-anchored mart can take several seconds, so the registry list
 * renders immediately and the console fills the as-of labels in once this
 * resolves. Read-only introspection (service principal), same per-game scope
 * validation as the registry route.
 */

import type { FastifyInstance } from 'fastify';
import { getGameMembers } from '../care/availability.js';
import { mergePlaybooks } from '../care/playbook-merge.js';
import { loadCalibration } from '../care/calibrate.js';
import { resolveGameScope } from '../care/game-scope.js';
import { resolveCubeFreshness } from '../care/data-freshness.js';
import { getMetaWithCtx } from '../services/cube-client.js';

export default async function careDataFreshnessRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/care/data-freshness', async (req, reply) => {
    const scope = resolveGameScope(req.workspace, (req.query as { game?: string })?.game);
    if (!scope.ok) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    }
    const game = (req.query as { game: string }).game.trim();

    const ctx = req.buildIntrospectionCtxForGame
      ? req.buildIntrospectionCtxForGame(game)
      : req.cubeCtx;
    const cacheKey = `${req.workspace.id}:${game}`;

    const members = await getGameMembers(ctx, scope.gamePrefix, cacheKey);
    const playbooks = mergePlaybooks(game, members, undefined, { calibration: loadCalibration(game) });

    // Only date the cubes that back a queryable playbook — skip blocked rows
    // (no cohort, nothing to stamp) so a probe never runs for unusable data.
    const cubes = new Set<string>();
    for (const p of playbooks) {
      if (p.availability === 'unavailable') continue;
      const cube = p.dataRequirements[0]?.split('.')[0];
      if (cube) cubes.add(cube);
    }

    let asOfByCube: Record<string, string> = {};
    try {
      const meta = await getMetaWithCtx(ctx);
      asOfByCube = await resolveCubeFreshness(ctx, meta, scope.gamePrefix, game, cacheKey, cubes);
    } catch {
      // Meta unreachable → empty map; the console simply omits the as-of labels.
      asOfByCube = {};
    }

    return { game, asOfByCube };
  });
}
