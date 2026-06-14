/**
 * Optimization Advisor API — the decision rail in front of the Experiment
 * Command Center.
 *
 *   POST /api/advisor/diagnose   → run the lens engine over a scope+goal
 *   POST /api/advisor/recommend  → diagnose + rank into experiment candidates
 *   POST /api/advisor/handoff    → scaffold an EDITABLE draft (never launches)
 *   POST /api/advisor/feedback   → record dismiss/pin with a reason
 *   GET  /api/advisor/drafts/:segmentId → list scaffolded drafts (inspection)
 *
 * Diagnosis is an on-demand live Cube read. On a host without Cube/Trino the
 * engine fail-closes and the route returns 502 — it never fabricates metrics.
 * The asOf anchor is supplied here (the I/O boundary); the compute engines
 * never call new Date() so results are reproducible given the same asOf.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { introspectionCtx } from './identity-map.js';
import { diagnose } from '../advisor/diagnosis-engine.js';
import { recommend, type RecommendParams } from '../advisor/recommend.js';
import { scaffoldDraft } from '../advisor/handoff-scaffolder.js';
import { saveDraft, getDraft, listDraftsForSegment } from '../advisor/command-center-draft-store.js';
import { recordFeedback, listFeedbackForSegment } from '../advisor/feedback-store.js';
import type { ScopeRef, DiagnosisInput } from '../advisor/diagnosis-types.js';
import type { ExperimentCandidate } from '../advisor/candidate-types.js';
import type { FeedbackAction } from '../advisor/feedback-store.js';

/** Parse a goal string into the engine's enum; default 'both'. */
function parseGoal(raw: unknown): DiagnosisInput['goal'] {
  return raw === 'revenue' || raw === 'engagement' ? raw : 'both';
}

/** Parse and validate a scope object from the request body. */
function parseScope(raw: unknown): ScopeRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.kind === 'game' && typeof s.gameId === 'string') {
    return { kind: 'game', gameId: s.gameId };
  }
  if (
    s.kind === 'segment' &&
    typeof s.segmentId === 'string' &&
    typeof s.gameId === 'string'
  ) {
    return { kind: 'segment', segmentId: s.segmentId, gameId: s.gameId };
  }
  return null;
}

/** asOf comes from the client as ISO string; the route is allowed to default to now. */
function parseAsOf(raw: unknown): Date {
  if (typeof raw === 'string') {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Lenses array → numeric ids only. */
function parseLenses(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((n): n is number => typeof n === 'number');
  return ids.length > 0 ? ids : undefined;
}

function buildDiagnosisInput(body: Record<string, unknown>): DiagnosisInput | null {
  const scope = parseScope(body.scope);
  if (!scope) return null;
  return {
    scope,
    goal: parseGoal(body.goal),
    asOf: parseAsOf(body.asOf),
    options: { lenses: parseLenses(body.lenses) },
  };
}

export default async function advisorRoutes(app: FastifyInstance): Promise<void> {
  // ── Diagnose ────────────────────────────────────────────────────────────────
  app.post('/api/advisor/diagnose', async (req: FastifyRequest, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input = buildDiagnosisInput(body);
    if (!input) {
      return reply.status(400).send({ error: 'invalid scope — expected {kind:"segment"|"game", gameId, segmentId?}' });
    }
    try {
      const diagnosis = await diagnose(input, introspectionCtx(req));
      return diagnosis;
    } catch (err) {
      req.log.error({ err }, 'advisor diagnose failed');
      return reply.status(502).send({
        error: 'diagnosis unavailable — live Cube read failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── Recommend ─────────────────────────────────────────────────────────────────
  app.post('/api/advisor/recommend', async (req: FastifyRequest, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input = buildDiagnosisInput(body);
    if (!input) {
      return reply.status(400).send({ error: 'invalid scope' });
    }
    const rawParams = (body.params ?? {}) as Record<string, unknown>;
    const addressableN = typeof rawParams.addressableN === 'number' ? rawParams.addressableN : 0;
    if (addressableN <= 0) {
      return reply.status(400).send({ error: 'params.addressableN (>0) is required to rank candidates' });
    }
    const params: RecommendParams = {
      addressableN,
      reachablePct: typeof rawParams.reachablePct === 'number' ? rawParams.reachablePct : undefined,
      windowDays: typeof rawParams.windowDays === 'number' ? rawParams.windowDays : undefined,
      baselineRate: typeof rawParams.baselineRate === 'number' ? rawParams.baselineRate : undefined,
      valuePerUnitVnd: typeof rawParams.valuePerUnitVnd === 'number' ? rawParams.valuePerUnitVnd : undefined,
      phrase: rawParams.phrase === true,
      phraseTopN: typeof rawParams.phraseTopN === 'number' ? rawParams.phraseTopN : undefined,
    };
    try {
      const result = await recommend(input, introspectionCtx(req), params);
      return result;
    } catch (err) {
      req.log.error({ err }, 'advisor recommend failed');
      return reply.status(502).send({
        error: 'recommendation unavailable — live Cube read failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── Hand-off (scaffold editable draft; NEVER launches) ──────────────────────────
  app.post('/api/advisor/handoff', async (req: FastifyRequest, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const candidate = body.candidate as ExperimentCandidate | undefined;
    const segmentId = typeof body.segmentId === 'string' ? body.segmentId : null;
    const gameId = typeof body.gameId === 'string' ? body.gameId : null;
    const addressableN = typeof body.addressableN === 'number' ? body.addressableN : null;
    const reachablePct = typeof body.reachablePct === 'number' ? body.reachablePct : 0.75;
    if (!candidate || !candidate.id || !segmentId || !gameId || addressableN == null) {
      return reply.status(400).send({
        error: 'handoff requires { candidate, segmentId, gameId, addressableN }',
      });
    }
    const draft = scaffoldDraft({
      candidate,
      segmentId,
      gameId,
      addressableN,
      reachablePct,
      windowDays: typeof body.windowDays === 'number' ? body.windowDays : undefined,
      treatmentShare: typeof body.treatmentShare === 'number' ? body.treatmentShare : undefined,
    });
    saveDraft(draft);
    // 201 — a draft was created/updated for inspection; nothing launched.
    return reply.status(201).send(draft);
  });

  // ── List drafts for a segment (inspection / command-center screen) ──────────────
  app.get('/api/advisor/drafts/:segmentId', async (req: FastifyRequest, reply) => {
    const { segmentId } = req.params as { segmentId: string };
    if (!segmentId) return reply.status(400).send({ error: 'segmentId required' });
    return { drafts: listDraftsForSegment(segmentId) };
  });

  // ── Single draft by id ──────────────────────────────────────────────────────────
  app.get('/api/advisor/draft/:draftId', async (req: FastifyRequest, reply) => {
    const { draftId } = req.params as { draftId: string };
    const draft = getDraft(decodeURIComponent(draftId ?? ''));
    if (!draft) return reply.status(404).send({ error: 'draft not found' });
    return draft;
  });

  // ── Feedback (dismiss/pin with reason) ──────────────────────────────────────────
  app.post('/api/advisor/feedback', async (req: FastifyRequest, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const segmentId = typeof body.segmentId === 'string' ? body.segmentId : null;
    const gameId = typeof body.gameId === 'string' ? body.gameId : null;
    const factor = typeof body.factor === 'string' ? body.factor : null;
    const action = body.action as FeedbackAction | undefined;
    const reason = typeof body.reason === 'string' ? body.reason : null;
    if (!segmentId || !gameId || !factor || (action !== 'dismiss' && action !== 'pin') || !reason) {
      return reply.status(400).send({
        error: 'feedback requires { segmentId, gameId, factor, action:"dismiss"|"pin", reason }',
      });
    }
    recordFeedback({
      segmentId,
      gameId,
      factor,
      leverFamily: typeof body.leverFamily === 'string' ? body.leverFamily : undefined,
      action,
      reason,
      createdBy: req.user?.username ?? req.user?.email ?? undefined,
    });
    return reply.status(201).send({ ok: true });
  });

  // ── Read feedback for a segment ─────────────────────────────────────────────────
  app.get('/api/advisor/feedback/:segmentId', async (req: FastifyRequest) => {
    const { segmentId } = req.params as { segmentId: string };
    return { feedback: listFeedbackForSegment(segmentId) };
  });
}
