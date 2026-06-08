/**
 * VIP-care playbook registry route.
 *
 * GET /api/care/playbooks?game=<id> — the merged seed ⊕ override view for a game,
 * each playbook resolved against that game's live Cube /meta (availability) and
 * its threshold rule compiled to a cohort predicate where possible.
 *
 * This is the single source every console surface reads (monitor, builder,
 * ledger). Phase-6 adds the write endpoints (POST/PATCH/DELETE) on this table.
 */

import type { FastifyInstance } from 'fastify';
import { getGameMembers } from '../care/availability.js';
import { mergePlaybooks } from '../care/playbook-merge.js';
import { loadCalibration } from '../care/calibrate.js';
import { resolveGameScope } from '../care/game-scope.js';

export default async function carePlaybooksRoutes(app: FastifyInstance): Promise<void> {
  // Read-only registry + per-game availability (no per-user cube DATA), so —
  // like the /meta introspection ctx — it runs under the service principal and
  // is not gated on the user's per-game cube grant. The game param is instead
  // validated against the workspace's known games (resolveGameScope), which
  // bounds it to a real game and blocks path traversal into the calibration file.
  app.get('/api/care/playbooks', async (req, reply) => {
    const scope = resolveGameScope(req.workspace, (req.query as { game?: string })?.game);
    if (!scope.ok) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: scope.error } });
    }
    const game = (req.query as { game: string }).game.trim();

    const ctx = req.buildIntrospectionCtxForGame
      ? req.buildIntrospectionCtxForGame(game)
      : req.cubeCtx;
    const cacheKey = `${req.workspace.id}:${game}`;

    // Member set scoped to THIS game's prefix (never the union of all games).
    // Empty set (unreachable /meta) → every playbook resolves unavailable
    // (fail-closed). The monitor still renders the full registry, greyed.
    const members = await getGameMembers(ctx, scope.gamePrefix, cacheKey);
    const playbooks = mergePlaybooks(game, members, undefined, {
      calibration: loadCalibration(game),
    });

    return {
      game,
      meta_members: members.size,
      counts: {
        total: playbooks.length,
        available: playbooks.filter((p) => p.availability === 'available').length,
        partial: playbooks.filter((p) => p.availability === 'partial').length,
        unavailable: playbooks.filter((p) => p.availability === 'unavailable').length,
      },
      playbooks,
    };
  });
}
