/**
 * Cross-game Cube model parity-audit API — backs the Model Audit console.
 *
 *   GET  /api/cube-parity/runs                      → recorded audit runs (newest first)
 *   GET  /api/cube-parity/runs/:runId               → one run header + its cube grid
 *   GET  /api/cube-parity/runs/:runId/findings      → findings for a run
 *   GET  /api/cube-parity/diff/dev-vs-prod          → dev↔prod-clone diff for game+cube
 *   GET  /api/cube-parity/diff/versions             → dev version↔version diff
 *   GET  /api/cube-parity/versions                  → cube dev-YAML version timeline
 *   GET  /api/cube-parity/prod-status               → local clone vs kraken/cube upstream
 *   POST /api/cube-parity/refresh-prod              → ff-only git pull of the clone
 *   POST /api/cube-parity/run-audit                 → run the harness + persist a run
 *
 * `:runId` accepts the literal `latest` → newest ok run. Admin-gated: this is an
 * internal model-engineering surface exposing model structure + git metadata
 * (no player data). Read endpoints never mutate; only refresh-prod/run-audit do.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { getDb } from '../db/sqlite.js';
import {
  listRuns,
  getRun,
  latestOkRunId,
  listFindings,
  listRunCubes,
} from '../services/cube-parity/cube-yaml-snapshot-reader.js';
import {
  diffDevVsProd,
  diffDevVersions,
  listCubeVersions,
  prodCloneStatus,
  refreshProdClone,
} from '../services/cube-model-diff.js';
import { runAndRecord } from '../services/cube-parity-recorder.js';

/** Resolve a `:runId` param (number or `latest`) to a concrete run id, or null. */
function resolveRunId(raw: string): number | null {
  if (raw === 'latest') return latestOkRunId(getDb());
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

export default async function cubeParityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));

  app.get('/api/cube-parity/runs', async () => ({ runs: listRuns(getDb()) }));

  app.get<{ Params: { runId: string } }>(
    '/api/cube-parity/runs/:runId',
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      const rid = resolveRunId(req.params.runId);
      if (rid == null) return reply.status(404).send({ error: 'no run' });
      const run = getRun(getDb(), rid);
      if (!run) return reply.status(404).send({ error: 'run not found' });
      return { run, cubes: listRunCubes(getDb(), rid) };
    },
  );

  app.get<{ Params: { runId: string } }>(
    '/api/cube-parity/runs/:runId/findings',
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      const rid = resolveRunId(req.params.runId);
      if (rid == null) return reply.status(404).send({ error: 'no run' });
      return { runId: rid, findings: listFindings(getDb(), rid) };
    },
  );

  app.get<{ Querystring: { game?: string; cube?: string; runId?: string } }>(
    '/api/cube-parity/diff/dev-vs-prod',
    async (req: FastifyRequest<{ Querystring: { game?: string; cube?: string; runId?: string } }>, reply: FastifyReply) => {
      const { game, cube, runId } = req.query;
      if (!game || !cube) return reply.status(400).send({ error: 'game and cube required' });
      const rid = runId ? resolveRunId(runId) ?? undefined : undefined;
      const diff = diffDevVsProd(game, cube, rid);
      if (!diff) return reply.status(404).send({ error: 'no dev snapshot for that game/cube/run' });
      return diff;
    },
  );

  app.get<{ Querystring: { game?: string; cube?: string; from?: string; to?: string } }>(
    '/api/cube-parity/diff/versions',
    async (
      req: FastifyRequest<{ Querystring: { game?: string; cube?: string; from?: string; to?: string } }>,
      reply: FastifyReply,
    ) => {
      const { game, cube, from, to } = req.query;
      if (!game || !cube || !from || !to) {
        return reply.status(400).send({ error: 'game, cube, from, to required' });
      }
      const fromId = Number.parseInt(from, 10);
      const toId = Number.parseInt(to, 10);
      if (Number.isNaN(fromId) || Number.isNaN(toId)) {
        return reply.status(400).send({ error: 'from/to must be run ids' });
      }
      const diff = diffDevVersions(game, cube, fromId, toId);
      if (!diff) return reply.status(404).send({ error: 'snapshot missing for one of the runs' });
      return diff;
    },
  );

  app.get<{ Querystring: { game?: string; cube?: string } }>(
    '/api/cube-parity/versions',
    async (req: FastifyRequest<{ Querystring: { game?: string; cube?: string } }>, reply: FastifyReply) => {
      const { game, cube } = req.query;
      if (!game || !cube) return reply.status(400).send({ error: 'game and cube required' });
      return { game, cube, versions: listCubeVersions(game, cube) };
    },
  );

  app.get('/api/cube-parity/prod-status', async () => prodCloneStatus());

  app.post('/api/cube-parity/refresh-prod', async () => refreshProdClone());

  // Synchronous run: the harness reads YAML files (fast) and the recorder
  // persists in one transaction. Returns the new run summary for the UI.
  app.post('/api/cube-parity/run-audit', async () => {
    const result = runAndRecord();
    return result;
  });
}
