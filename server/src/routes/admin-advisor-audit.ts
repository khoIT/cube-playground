/**
 * Admin advisor-audit routes — cross-user read access to the durable audit trail
 * of the in-process Optimization Advisor agent (migration 055 tables).
 *
 * Unlike admin-chat-audit.ts, the advisor runs IN-PROCESS — there is no remote
 * chat-service to proxy and no Keycloak sub to resolve. Runs already carry their
 * `owner`, so the routes read straight from advisor-run-store.ts.
 *
 * Guards are re-declared on THIS plugin (Fastify encapsulation: a separate
 * plugin does NOT inherit hooks from any sibling). Every route is admin-only and
 * read-only, and returns only PII-free persisted fields.
 *
 * Routes:
 *   GET /api/admin/advisor/runs?game=&goal=&owner=&stopReason=&q=&limit=
 *   GET /api/admin/advisor/runs/:sessionId
 *   GET /api/admin/advisor/runs/:sessionId/events?turnIndex=&cursor=&limit=
 *   GET /api/admin/advisor/owners
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { listRuns, getRunDetail, listEvents, listOwners } from '../advisor/agent/advisor-run-store.js';

/** Stop reasons accepted by the ?stopReason filter (plus 'all' = no filter). */
const STOP_REASONS = new Set(['all', 'end_turn', 'max_turns', 'budget', 'timeout', 'aborted', 'error']);

function clampLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, Math.floor(n)), max);
}

export default async function adminAdvisorAuditRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  // --- GET /api/admin/advisor/runs ---
  app.get<{ Querystring: { game?: string; goal?: string; owner?: string; stopReason?: string; q?: string; limit?: string } }>(
    '/api/admin/advisor/runs',
    async (
      request: FastifyRequest<{
        Querystring: { game?: string; goal?: string; owner?: string; stopReason?: string; q?: string; limit?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { game, goal, owner, q } = request.query;
      const stopReason = request.query.stopReason && STOP_REASONS.has(request.query.stopReason)
        ? request.query.stopReason
        : undefined;
      const limit = clampLimit(request.query.limit, 500, 500);
      const runs = listRuns({ game, goal, owner, stopReason, q, limit });
      return reply.send({ runs });
    },
  );

  // --- GET /api/admin/advisor/runs/:sessionId ---
  app.get<{ Params: { sessionId: string } }>(
    '/api/admin/advisor/runs/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const detail = getRunDetail(request.params.sessionId);
      if (!detail) return reply.status(404).send({ code: 'run_not_found', message: 'No advisor run for that session id' });
      return reply.send(detail);
    },
  );

  // --- GET /api/admin/advisor/runs/:sessionId/events ---
  app.get<{ Params: { sessionId: string }; Querystring: { turnIndex?: string; cursor?: string; limit?: string } }>(
    '/api/admin/advisor/runs/:sessionId/events',
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Querystring: { turnIndex?: string; cursor?: string; limit?: string } }>,
      reply: FastifyReply,
    ) => {
      const turnIndexRaw = Number(request.query.turnIndex);
      const cursorRaw = Number(request.query.cursor);
      const result = listEvents(request.params.sessionId, {
        turnIndex: Number.isFinite(turnIndexRaw) ? turnIndexRaw : undefined,
        cursor: Number.isFinite(cursorRaw) ? cursorRaw : undefined,
        limit: clampLimit(request.query.limit, 200, 1000),
      });
      return reply.send(result);
    },
  );

  // --- GET /api/admin/advisor/owners ---
  app.get('/api/admin/advisor/owners', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ owners: listOwners() });
  });
}
