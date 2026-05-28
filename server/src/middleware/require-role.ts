/**
 * Route-level RBAC guard factory.
 *
 * Use as a Fastify preHandler:
 *
 *   app.post('/api/segments', { preHandler: requireRole('editor', 'admin') }, …)
 *
 * Behavior:
 *   - `request.user` undefined → 401 (no/invalid token; authenticate.ts left it null).
 *   - `request.user.role` not in `allowed` → 403 (correctly authenticated, wrong tier).
 *
 * Routes that need *any* authenticated user (no role check) can use
 * `requireUser` instead.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

export type AppRole = 'viewer' | 'editor' | 'admin';

export function requireRole(...allowed: AppRole[]): preHandlerHookHandler {
  const set = new Set<AppRole>(allowed);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
    if (!set.has(request.user.role)) {
      return reply.status(403).send({
        error: 'Insufficient permissions',
        required: allowed,
        actual: request.user.role,
      });
    }
  };
}

export const requireUser: preHandlerHookHandler = async (request, reply) => {
  if (!request.user) return reply.status(401).send({ error: 'Not authenticated' });
};
