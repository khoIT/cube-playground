/**
 * Admin cost observability API — org-wide LLM spend rollup.
 *
 *   GET /api/admin/cost/summary?from=<iso>&to=<iso>&limit=<n>
 *     → total + breakdowns by user / game / workspace + top-N sessions by
 *       cost, fetched from the chat-service cost bridge. Omitting `from`
 *       means all-time ("total cost of the whole app").
 *
 * Identity: chat-service keys owner rows on Keycloak `sub`; this route
 * enriches each owner/session row with the matching email via
 * `user_access.kc_sub` so the admin UI can show emails and deep-link to the
 * per-user activity profile. A sub with no access record (departed user)
 * keeps `email: null` and falls back to its stamped owner_label in the UI.
 *
 * Graceful degradation: chat-service slow/down → `breakdown: null`, never a
 * 500 (mirrors the activity rollup contract).
 *
 * Guards: separate Fastify plugin (encapsulation) — admin role + feature
 * hooks are re-declared at router scope like admin-activity.ts.
 */

import type { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { listUsers } from '../auth/access-store.js';
import { fetchCostBreakdown, type CostBreakdown } from '../services/chat-cost-client.js';

interface CostQuery {
  from?: string;
  to?: string;
  limit?: string;
}

/** sub → email map from the canonical access store (users without a sub are skipped). */
function buildSubToEmailMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of listUsers()) {
    if (u.kcSub) map.set(u.kcSub, u.email);
  }
  return map;
}

/** Attach `email` (null when the sub is unknown) to owner-keyed rows. */
function withEmail<T extends { owner_id: string }>(
  rows: T[],
  subToEmail: Map<string, string>,
): Array<T & { email: string | null }> {
  return rows.map((r) => ({ ...r, email: subToEmail.get(r.owner_id) ?? null }));
}

export default async function adminCostRoutes(app: FastifyInstance): Promise<void> {
  // Router-scope enforcement: admin role AND the admin feature, on every route.
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  app.get<{ Querystring: CostQuery }>('/api/admin/cost/summary', async (req, reply) => {
    const toMs = req.query.to ? Date.parse(req.query.to) : Date.now();
    const fromMs = req.query.from ? Date.parse(req.query.from) : undefined; // undefined → all-time
    if ((fromMs !== undefined && isNaN(fromMs)) || isNaN(toMs)) {
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Invalid from/to date (use ISO 8601)' } });
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const breakdown: CostBreakdown | null = await fetchCostBreakdown({
      fromMs,
      toMs,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    if (!breakdown) {
      return { generatedAt: Date.now(), breakdown: null };
    }

    const subToEmail = buildSubToEmailMap();
    return {
      generatedAt: Date.now(),
      breakdown: {
        total: breakdown.total,
        byUser: withEmail(breakdown.by_owner, subToEmail),
        byGame: breakdown.by_game,
        byWorkspace: breakdown.by_workspace,
        sessions: withEmail(breakdown.sessions, subToEmail),
        sessionTotal: breakdown.session_total,
      },
    };
  });
}
