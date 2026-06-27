/**
 * Admin-only consumption observability for a served segment.
 *
 * Mirrors the pull-credentials gate EXACTLY (guardSegment 'read' → then
 * admin-only) — token/key metadata and pull history are governance material, not
 * owner-visible. A non-admin owner gets 403 and uses the read-only deep-link to
 * the admin API-keys tab instead.
 *
 *   GET /api/segments/:id/consumption?window=24h|7d|30d  summary + byKey + daily + status + recent
 *   GET /api/segments/:id/pulls?cursor&limit                paginated per-page pull log
 *   GET /api/segments/:id/tokens                            entitled keys (+ everPulled)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { guardSegment, type SegmentRow } from './segments.js';
import { getConsumption, recentPulls, tokensForSegment } from '../services/segment-consumption-store.js';

/** guardSegment('read') then admin-only. Returns the row, or null after sending. */
function requireAdminSegment(req: FastifyRequest, reply: FastifyReply, id: string): SegmentRow | null {
  const row = guardSegment(req, reply, id, 'read');
  if (!row) return null;
  if (req.principal.role !== 'admin') {
    reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Admin only — consumption history reveals consumer key metadata.' } });
    return null;
  }
  return row;
}

export default async function segmentConsumptionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/segments/:id/consumption', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!requireAdminSegment(req, reply, id)) return reply;
    const window = String((req.query as { window?: string }).window ?? '7d');
    const now = Date.now();
    const view = getConsumption(id, window, now);
    const recent = recentPulls(id, { limit: 50 });
    return { ...view, recentPulls: recent.items, recentCursor: recent.nextCursor };
  });

  app.get('/api/segments/:id/pulls', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!requireAdminSegment(req, reply, id)) return reply;
    const q = req.query as { cursor?: string; limit?: string };
    const cursor = q.cursor ? Number(q.cursor) : undefined;
    const limit = q.limit ? Number(q.limit) : undefined;
    return recentPulls(id, { cursor: Number.isFinite(cursor) ? cursor : undefined, limit });
  });

  app.get('/api/segments/:id/tokens', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = requireAdminSegment(req, reply, id);
    if (!row) return reply;
    return { tokens: tokensForSegment({ id, workspace: (row.workspace as string) ?? null, game_id: (row.game_id as string) ?? null }) };
  });
}
