/**
 * Care-tab precompute status + manual-trigger API.
 *
 *   GET  /api/admin/care-precompute/runs?segmentId=&limit=
 *        — recent precompute passes (newest first) + per-segment cache freshness.
 *   POST /api/admin/care-precompute/runs  { segmentId }
 *        — manual "run now" (202 accepted / 429 cooldown). Runs on the shared
 *          serial chain so it never races the nightly pass.
 *
 * Admin-gated (requireRole('admin') + requireFeature('admin')), matching the
 * pre-agg run history routes.
 */

import type { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { listCareRuns } from '../db/segment-care-run-store.js';
import { listCareCacheStatuses } from '../db/segment-care-cache-store.js';
import {
  triggerCarePrecompute,
  triggerCareRewarmAll,
  parseCareWindow,
} from '../services/care-precompute-scheduler.js';

export default async function carePrecomputeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  // ── GET /api/admin/care-precompute/runs ──────────────────────────────────
  app.get<{ Querystring: { segmentId?: string; limit?: string } }>(
    '/api/admin/care-precompute/runs',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);
      const runs = listCareRuns({ segmentId: req.query.segmentId, limit });
      const cache = listCareCacheStatuses();
      const window = parseCareWindow();
      return {
        runs,
        cache,
        window: { startMin: window.startMin, endMin: window.endMin },
      };
    },
  );

  // ── POST /api/admin/care-precompute/runs ─────────────────────────────────
  // Body { segmentId } warms one segment; an empty/absent segmentId re-warms
  // EVERY CS-covered segment (full pass, regardless of freshness).
  app.post<{ Body: { segmentId?: string } }>(
    '/api/admin/care-precompute/runs',
    async (req, reply) => {
      const segmentId = String(req.body?.segmentId ?? '').trim();

      if (!segmentId) {
        const result = triggerCareRewarmAll();
        if (!result.accepted) {
          return reply.status(429).send({
            error: { code: 'RATE_LIMITED', message: 'A full re-warm is already running' },
          });
        }
        return reply.status(202).send({ status: 'precomputing', scope: 'all', count: result.count });
      }

      const result = triggerCarePrecompute(segmentId);
      if (!result.accepted) {
        reply.header('retry-after', String(Math.ceil((result.retryAfterMs ?? 0) / 1000)));
        return reply.status(429).send({
          error: { code: 'RATE_LIMITED', message: 'Care precompute already triggered recently' },
        });
      }
      return reply.status(202).send({ status: 'precomputing', scope: 'segment' });
    },
  );
}
