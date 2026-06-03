/**
 * Admin chat-audit routes — cross-user read access to another user's chat data.
 *
 * This is the authorization boundary that separates self-scoped chat access (chat.ts)
 * from admin-scoped cross-user access. An admin provides ?email=<targetEmail> and we
 * resolve the target's Keycloak sub (= chat owner_id) before proxying to the chat-service.
 * The chat-service never sees the admin's own sub — it sees the TARGET user's sub.
 *
 * Guards are re-declared on THIS plugin (Fastify encapsulation: a separate plugin
 * does NOT inherit hooks from admin-access.ts or any sibling plugin).
 *
 * Proxy reuse: we export `proxyJson` and `chatServiceUrl` from chat.ts and import
 * them here. This avoids duplicating the proxy body while keeping the two route
 * files independently deployable. The alternative (a shared helper module) would
 * add a third file with no additional value given the two-function surface.
 *
 * Routes (all admin-only, all require ?email=<targetUserEmail>):
 *   GET /api/admin/chat/sessions?email=&game=&q=&limit=
 *   GET /api/admin/chat/sessions/:id?email=
 *   GET /api/admin/chat/turns/:turnId?email=
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { getAccess } from '../auth/access-store.js';
import { proxyJson, chatServiceUrl } from './chat.js';

// ---- Shared email→sub resolver ----------------------------------------------

interface ResolveResult {
  /** Resolved Keycloak sub for the target user. */
  targetSub: string;
}

/**
 * Resolves ?email to a Keycloak sub. Returns a FastifyReply early-exit
 * (already sent) when validation fails, or a ResolveResult on success.
 *
 * Failure modes:
 *   - Missing email param → 400
 *   - Unknown email or user has no sub (never logged in) → 404
 */
async function resolveTargetSub(
  email: string | undefined,
  reply: FastifyReply,
): Promise<ResolveResult | null> {
  if (!email || !email.trim()) {
    await reply.status(400).send({ code: 'missing_email', message: '?email=<targetEmail> is required' });
    return null;
  }
  const access = getAccess(email.trim());
  // A user without a kc_sub has never authenticated; chat-service has no data for them.
  if (!access || !access.kcSub) {
    await reply.status(404).send({ code: 'unknown_target_user', message: `No active user found for: ${email}` });
    return null;
  }
  return { targetSub: access.kcSub };
}

// ---- Plugin -----------------------------------------------------------------

export default async function adminChatAuditRoutes(app: FastifyInstance): Promise<void> {
  // Router-scope enforcement: admin role AND the admin feature on every route in
  // this plugin. Re-declared here because Fastify encapsulation means this plugin
  // does NOT inherit hooks from any sibling (admin-access.ts, admin-activity.ts).
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  // --- GET /api/admin/chat/sessions?email=&game=&q=&limit= ---
  // Lists the target user's debug sessions. Proxies to the same /debug/sessions
  // endpoint that the self-scoped DevAudit UI uses, but with the TARGET user's sub.
  app.get<{ Querystring: { email?: string; game?: string; q?: string; limit?: string } }>(
    '/api/admin/chat/sessions',
    async (
      request: FastifyRequest<{ Querystring: { email?: string; game?: string; q?: string; limit?: string } }>,
      reply: FastifyReply,
    ) => {
      const resolved = await resolveTargetSub(request.query.email, reply);
      if (!resolved) return;

      const params = new URLSearchParams();
      if (request.query.game) params.set('game', request.query.game);
      if (request.query.q) params.set('q', request.query.q);
      if (request.query.limit) params.set('limit', request.query.limit);
      const url = `${chatServiceUrl()}/debug/sessions?${params.toString()}`;

      try {
        const { status, payload } = await proxyJson(url, 'GET', resolved.targetSub, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/admin/chat/sessions/:id?email= ---
  // Fetches a single session detail for the target user.
  app.get<{ Params: { id: string }; Querystring: { email?: string } }>(
    '/api/admin/chat/sessions/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { email?: string } }>,
      reply: FastifyReply,
    ) => {
      const resolved = await resolveTargetSub(request.query.email, reply);
      if (!resolved) return;

      const url = `${chatServiceUrl()}/debug/sessions/${encodeURIComponent(request.params.id)}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', resolved.targetSub, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/admin/chat/turns/:turnId?email= ---
  // Fetches a single turn detail for the target user.
  app.get<{ Params: { turnId: string }; Querystring: { email?: string } }>(
    '/api/admin/chat/turns/:turnId',
    async (
      request: FastifyRequest<{ Params: { turnId: string }; Querystring: { email?: string } }>,
      reply: FastifyReply,
    ) => {
      const resolved = await resolveTargetSub(request.query.email, reply);
      if (!resolved) return;

      const url = `${chatServiceUrl()}/debug/turns/${encodeURIComponent(request.params.turnId)}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', resolved.targetSub, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );
}
