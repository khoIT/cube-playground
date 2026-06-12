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
import { listSweeps, getSweepWithItems, latestSealedByGameCube, builtLinesBySweep } from '../db/preagg-run-store.js';
import { getPreaggReadinessNonBlocking } from '../services/preagg-readiness.js';
import { getDefaultWorkspace } from '../services/workspaces-config-loader.js';
import { getCollectorStatus } from '../services/preagg-run-collector.js';
import { isKnownGame } from '../services/games-config-loader.js';
import { isTriggerEnabled, getTriggerState, startTrigger } from '../services/preagg-trigger.js';
import { getBuildProgress } from '../services/preagg-build-progress.js';

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
      // Name the built work on each header so the collapsed row can show
      // WHICH games/rollups rebuilt — items themselves load on expand.
      const built = builtLinesBySweep(db, sweeps.map((s) => s.id));
      for (const s of sweeps) {
        const lines = built.get(s.id);
        if (lines) s.built = lines;
      }
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

    // The probe only classifies built/unbuilt; seal TIMES live in sweep
    // history. Attach the most recent known seal per (game, cube) so the
    // readiness matrix can show "last sealed Xh ago" on each cell.
    const sealMap = new Map(
      latestSealedByGameCube(getDb()).map((s) => [`${s.game}|${s.cube}`, s.lastSealedAt]),
    );
    const games = readiness.games.map((g) => ({
      ...g,
      cubes: g.cubes.map((c) => ({
        ...c,
        lastSealedAt: sealMap.get(`${g.id}|${c.cube}`) ?? null,
      })),
    }));

    return {
      generatedAt: readiness.generatedAt,
      note: readiness.note ?? null,
      games,
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

  // ── Build trigger (dev/demo) ───────────────────────────────────────────────
  // Registered before /:id so the literal paths win over the numeric param.

  app.get('/api/preagg-runs/trigger/status', async () => {
    return { enabled: isTriggerEnabled(), state: getTriggerState() };
  });

  // ── GET /api/preagg-runs/build-progress ──────────────────────────────────
  // Live per-rollup progress of the current (or just-finished) triggered
  // build, derived from the worker's docker logs. Null when idle.
  app.get('/api/preagg-runs/build-progress', async () => {
    return { progress: await getBuildProgress() };
  });

  app.post<{ Body: { game?: string; minutes?: number } }>(
    '/api/preagg-runs/trigger',
    async (req, reply) => {
      if (!isTriggerEnabled()) {
        return reply.status(403).send({
          error: { code: 'TRIGGER_DISABLED', message: 'Pre-agg build trigger is disabled (set PREAGG_TRIGGER_ENABLED=true on a dev host).' },
        });
      }
      const game = String(req.body?.game ?? '');
      if (!isKnownGame(game)) {
        return reply.status(400).send({ error: { code: 'BAD_GAME', message: `Unknown game '${game}'.` } });
      }
      const result = startTrigger(game, req.body?.minutes ?? 8);
      if (!result.ok) {
        // Busy = 409 conflict; anything else (disabled, bad game) handled above.
        return reply.status(409).send({ error: { code: 'TRIGGER_BUSY', message: result.error ?? 'Cannot start build.' } });
      }
      return { ok: true, state: getTriggerState() };
    },
  );

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
