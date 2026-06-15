/**
 * Experiment routes — the persisted experiment behind the advisor's live
 * monitoring board.
 *
 *   GET   /api/experiments?game        — list (registry, by game)
 *   POST  /api/experiments             — create a draft from a segment   [write-gated]
 *   GET   /api/experiments/:id         — get one
 *   PATCH /api/experiments/:id         — edit draft params / status      [write-gated]
 *   POST  /api/experiments/:id/assign  — freeze the split (draft→running) [write-gated]
 *   GET   /api/experiments/:id/scorecard — real treatment-vs-hold-out outcomes
 *
 * Mutations rely on the global write-role gate (registered in index.ts). Reads
 * are game-scoped to the caller's workspace. The scorecard is the expensive call
 * (cube outcome scan) → cached with a short TTL, mirroring segment-cs-tickets.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { resolveGameScope } from '../care/game-scope.js';
import {
  createExperiment,
  getExperiment,
  listExperiments,
  patchExperiment,
  armUids,
  armCounts,
} from '../experiments/experiment-store.js';
import {
  assignExperiment,
  CohortEmptyError,
  ExperimentNotFoundError,
} from '../experiments/assignment-service.js';
import { readOutcomes } from '../experiments/experiment-outcome-reader.js';
import { computeScorecard } from '../experiments/scorecard-stats.js';
import { getDb } from '../db/sqlite.js';
import type { WorkspaceCtx } from '../services/cube-client.js';

const createSchema = z.object({
  game: z.string().min(1),
  name: z.string().min(3),
  segmentId: z.string().min(1),
  hypothesis: z.string().optional(),
  splitPct: z.number().int().min(1).max(99).optional(),
  primaryMetric: z.enum(['gross_payment_rate', 'sessions_per_week']).optional(),
  windowDays: z.number().int().min(1).max(90).optional(),
  cohortCap: z.number().int().min(1).max(200_000).optional(),
});

const patchSchema = z.object({
  name: z.string().min(3).optional(),
  hypothesis: z.string().optional(),
  splitPct: z.number().int().min(1).max(99).optional(),
  primaryMetric: z.enum(['gross_payment_rate', 'sessions_per_week']).optional(),
  windowDays: z.number().int().min(1).max(90).optional(),
  cohortCap: z.number().int().min(1).max(200_000).optional(),
  status: z.enum(['draft', 'running', 'completed', 'archived']).optional(),
});

function err(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, code: number, message: string) {
  return reply.code(code).send({ error: { code: String(code), message } });
}

/** A game-scoped experiment that belongs to the caller's workspace, or null. */
function inScope(req: FastifyRequest, id: string) {
  const exp = getExperiment(id);
  if (!exp) return null;
  const scope = resolveGameScope(req.workspace, exp.gameId);
  return scope.ok ? exp : null;
}

function ctxForGame(req: FastifyRequest, game: string): WorkspaceCtx {
  return req.buildIntrospectionCtxForGame ? req.buildIntrospectionCtxForGame(game) : req.cubeCtx;
}

/** The cohort segment's display name, or null if it no longer exists. */
function segmentNameOf(segmentId: string): string | null {
  const row = getDb()
    .prepare('SELECT name FROM segments WHERE id = ?')
    .get(segmentId) as { name: string } | undefined;
  return row?.name ?? null;
}

// ── Scorecard cache (mirror segment-cs-tickets) ──────────────────────────────
interface CacheEntry {
  at: number;
  payload: unknown;
}
const scorecardCache = new Map<string, CacheEntry>();
const SCORECARD_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

/** Test hook — drop the scorecard cache. */
export function __clearScorecardCache(): void {
  scorecardCache.clear();
}

export default async function experimentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/experiments', async (req, reply) => {
    const q = req.query as { game?: string; segment?: string };
    const scope = resolveGameScope(req.workspace, q?.game);
    if (!scope.ok) return err(reply, 400, 'unknown or missing game');
    // Optional `segment` filter powers the monitor's reuse-on-revisit lookup
    // ("is there already a running experiment for this cohort?"). Each row
    // carries its frozen arm counts so the list renders without N+1 fetches.
    const list = listExperiments(q.game!.trim(), {
      segmentId: q.segment?.trim() || undefined,
    });
    return {
      experiments: list.map((e) => ({
        ...e,
        arms: armCounts(e.id),
        segmentName: segmentNameOf(e.segmentId),
      })),
    };
  });

  app.post('/api/experiments', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return err(reply, 400, parsed.error.issues[0]?.message ?? 'invalid body');
    const body = parsed.data;
    const scope = resolveGameScope(req.workspace, body.game);
    if (!scope.ok) return err(reply, 400, 'unknown or missing game');

    // The cohort source segment must exist and belong to this game.
    const seg = getDb()
      .prepare('SELECT id, game_id FROM segments WHERE id = ?')
      .get(body.segmentId) as { id: string; game_id: string } | undefined;
    if (!seg) return err(reply, 404, 'segment not found');
    if (seg.game_id !== body.game) return err(reply, 400, 'segment belongs to a different game');

    const exp = createExperiment({
      gameId: body.game,
      workspace: req.workspace.id,
      name: body.name,
      hypothesis: body.hypothesis,
      segmentId: body.segmentId,
      splitPct: body.splitPct,
      primaryMetric: body.primaryMetric,
      windowDays: body.windowDays,
      cohortCap: body.cohortCap,
    });
    return reply.code(201).send({ experiment: exp });
  });

  app.get('/api/experiments/:id', async (req, reply) => {
    const exp = inScope(req, (req.params as { id: string }).id);
    if (!exp) return err(reply, 404, 'experiment not found');
    return { experiment: exp, arms: armCounts(exp.id), segmentName: segmentNameOf(exp.segmentId) };
  });

  app.patch('/api/experiments/:id', async (req, reply) => {
    const exp = inScope(req, (req.params as { id: string }).id);
    if (!exp) return err(reply, 404, 'experiment not found');
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return err(reply, 400, parsed.error.issues[0]?.message ?? 'invalid body');
    return { experiment: patchExperiment(exp.id, parsed.data) };
  });

  app.post('/api/experiments/:id/assign', async (req, reply) => {
    const exp = inScope(req, (req.params as { id: string }).id);
    if (!exp) return err(reply, 404, 'experiment not found');
    // `resync: true` re-freezes a running experiment against the segment's
    // current membership (new window). Absent/false = the original first-freeze.
    const resync = (req.body as { resync?: boolean } | undefined)?.resync === true;
    try {
      const result = assignExperiment(exp.id, new Date().toISOString(), { resync });
      scorecardCache.delete(exp.id); // arms changed → drop stale scorecard
      return { assignment: result };
    } catch (e) {
      if (e instanceof CohortEmptyError) {
        return err(reply, 409, 'source segment has no materialized members yet — refresh it first');
      }
      if (e instanceof ExperimentNotFoundError) return err(reply, 404, 'experiment not found');
      throw e;
    }
  });

  app.get('/api/experiments/:id/scorecard', async (req, reply) => {
    const exp = inScope(req, (req.params as { id: string }).id);
    if (!exp) return err(reply, 404, 'experiment not found');
    if (exp.status === 'draft' || !exp.assignedAt) {
      return err(reply, 409, 'experiment not assigned yet — freeze the groups first');
    }

    const cached = scorecardCache.get(exp.id);
    if (cached && Date.now() - cached.at < SCORECARD_TTL_MS) return cached.payload;

    const treatment = armUids(exp.id, 'treatment');
    const control = armUids(exp.id, 'control');
    let bundle;
    try {
      bundle = await readOutcomes(
        ctxForGame(req, exp.gameId),
        treatment,
        control,
        exp.assignedAt,
        exp.windowDays,
      );
    } catch (e) {
      req.log?.warn?.({ err: e, experimentId: exp.id }, 'scorecard outcome read failed');
      return err(reply, 502, 'outcome read failed (cube unavailable)');
    }

    const payload = {
      experimentId: exp.id,
      assignedAt: exp.assignedAt,
      windowDays: exp.windowDays,
      primaryMetric: exp.primaryMetric,
      currencies: bundle.currencies,
      arms: bundle.arms,
      series: bundle.series,
      scorecard: computeScorecard(bundle.arms),
    };

    if (scorecardCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = [...scorecardCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
      if (oldest) scorecardCache.delete(oldest);
    }
    scorecardCache.set(exp.id, { at: Date.now(), payload });
    return payload;
  });
}
