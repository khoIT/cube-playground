/**
 * Pre-aggregation run history API routes.
 *
 *   GET /api/preagg-runs?limit=30     — list sweeps (header only, newest first)
 *   GET /api/preagg-runs/current      — live serveability summary + collector status
 *   GET /api/preagg-runs/:id          — single sweep + all per-cube items
 *
 * All routes are admin-gated: requireRole('admin') + requireFeature('admin').
 * The /current endpoint calls computePreaggReadiness against the default
 * workspace; it is cached for 60s inside preagg-readiness.ts.
 */

import type { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { getDb } from '../db/sqlite.js';
import { listSweeps, getSweepWithItems } from '../db/preagg-run-store.js';
import { getPreaggReadinessNonBlocking } from '../services/preagg-readiness.js';
import { getDefaultWorkspace } from '../services/workspaces-config-loader.js';
import { getCollectorStatus } from '../services/preagg-run-collector.js';

export default async function preaggRunsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  // ── GET /api/preagg-runs ───────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string } }>(
    '/api/preagg-runs',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '30', 10) || 30, 100);
      const db = getDb();
      const sweeps = listSweeps(db, limit);
      return { sweeps };
    },
  );

  // ── GET /api/preagg-runs/current ──────────────────────────────────────────
  // Must be registered BEFORE /:id so the literal "current" path wins.
  app.get('/api/preagg-runs/current', async () => {
    const workspace = getDefaultWorkspace();
    const collector = getCollectorStatus();

    // Non-blocking: serves cached readiness instantly and warms in the
    // background. The live probe is a multi-second cube fan-out, so blocking
    // here would let a dev proxy time out and surface a spurious 500.
    const readiness = getPreaggReadinessNonBlocking(workspace);

    if (!readiness) {
      // Nothing cached yet — a background refresh is computing. Return a calm
      // empty summary flagged `warming` so the UI shows a warming hint and
      // retries, instead of an 8s hang or a 500.
      return {
        generatedAt: new Date().toISOString(),
        note: 'warming — serveability probe is computing; refresh in a few seconds',
        games: [],
        summary: { gamesCount: 0, totalRollups: 0, built: 0, unbuilt: 0, errored: 0 },
        collector,
        warming: true,
      };
    }

    // Flatten probe counts across all games for a quick summary
    let totalBuilt = 0;
    let totalUnbuilt = 0;
    let totalErrored = 0;
    for (const g of readiness.games) {
      totalBuilt += g.built;
      totalUnbuilt += g.unbuilt;
      totalErrored += g.errored;
    }
    const totalRollups = totalBuilt + totalUnbuilt + totalErrored;
    const gamesCount = readiness.games.length;

    return {
      generatedAt: readiness.generatedAt,
      note: readiness.note ?? null,
      games: readiness.games,
      summary: {
        gamesCount,
        totalRollups,
        built: totalBuilt,
        unbuilt: totalUnbuilt,
        errored: totalErrored,
      },
      collector,
      warming: false,
    };
  });

  // ── GET /api/preagg-runs/:id ───────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/preagg-runs/:id',
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return reply.status(400).send({ error: { code: 'BAD_ID', message: 'id must be an integer' } });
      }
      const db = getDb();
      const result = getSweepWithItems(db, id);
      if (!result) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Sweep not found' } });
      }
      return result;
    },
  );
}
