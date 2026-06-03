/**
 * Admin activity/observability API — org + per-user activity rollups.
 *
 *   GET /api/admin/activity/summary        → org rollup (status counts,
 *                                             active 7/30d, inactive list,
 *                                             top features, total chat turns)
 *   GET /api/admin/activity/users/:email   → per-user activity (last login,
 *                                             chat stats, recent features +
 *                                             query shapes, segment count)
 *
 * Guards: this is a SEPARATE Fastify plugin from `admin-access.ts`, so it does
 * NOT inherit that router's scoped preHandlers (Fastify encapsulation). The
 * `requireRole('admin') + requireFeature('admin')` hooks are re-declared here
 * at router scope so every route is admin-gated on its own.
 */

import type { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { buildActivitySummary, buildUserActivity } from '../services/activity-aggregator.js';
import { buildUserSessions } from '../services/session-aggregator.js';
import { getAccess, normalizeEmail } from '../auth/access-store.js';
import { queryAccessAudit, type AccessAuditFilters } from '../auth/access-audit-store.js';

interface AuditQuery {
  actor?: string;
  action?: string;
  target?: string;
  from?: string;
  to?: string;
  limit?: string;
}

export default async function adminActivityRoutes(app: FastifyInstance): Promise<void> {
  // Router-scope enforcement: admin role AND the admin feature, on every route.
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  app.get('/api/admin/activity/summary', async () => {
    return buildActivitySummary();
  });

  app.get<{ Params: { email: string } }>('/api/admin/activity/users/:email', async (req, reply) => {
    const activity = await buildUserActivity(decodeURIComponent(req.params.email));
    if (!activity) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown user' } });
    }
    return activity;
  });

  // Gap-derived session timeline. Separate from the activity rollup above so the
  // Access (govern) surface can read cheap vitals without pulling sessions, and
  // the Activity profile pulls sessions only when opened. 404s for an unknown
  // user; a known user with no events returns an empty (non-null) timeline.
  app.get<{ Params: { email: string }; Querystring: { limit?: string } }>(
    '/api/admin/activity/users/:email/sessions',
    async (req, reply) => {
      const email = decodeURIComponent(req.params.email);
      if (!getAccess(normalizeEmail(email))) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown user' } });
      }
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      return buildUserSessions(email, { limit: Number.isFinite(limit) ? limit : undefined });
    },
  );

  // Filtered audit-log read (newest-first) for the audit-log viewer.
  app.get<{ Querystring: AuditQuery }>('/api/admin/audit', async (req) => {
    const q = req.query;
    const filters: AccessAuditFilters = {
      actor: q.actor || undefined,
      action: q.action || undefined,
      target: q.target || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    };
    return { entries: queryAccessAudit(filters) };
  });
}
