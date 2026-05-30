/**
 * Global write-method RBAC gate for artifact routes.
 *
 * Rather than sprinkling `requireRole('editor','admin')` on every POST /
 * PUT / PATCH / DELETE handler, this preHandler runs once per request and
 * blocks viewer-role mutations on the artifact prefixes below.
 *
 * Per-row ownership checks (editor can only update own; admin can update
 * any) live inside each route handler — they need table-specific lookups
 * that don't belong in a global preHandler.
 *
 * Skipped entirely when AUTH_DISABLED=true (dev mode) — the synthesized
 * dev user is `admin`, so this would never trip anyway, but skipping is
 * one less surprise for local-dev expectations.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths that gate behind editor+; everything else is unaffected. Auth/cube
// proxy routes are intentionally excluded — the cube proxy is read-only
// semantically (POSTs are queries) and /api/auth/* is the login surface.
const PROTECTED_PREFIXES = [
  '/api/segments',
  '/api/dashboards',
  '/api/cube-aliases',
  '/api/user-prefs',
  '/api/business-metrics',
  '/api/analyses',
  '/api/onboarding',
];

function authDisabled(): boolean {
  const raw = (process.env.AUTH_DISABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function isProtectedWrite(req: FastifyRequest): boolean {
  if (!MUTATING.has(req.method)) return false;
  const url = req.routerPath ?? req.url;
  return PROTECTED_PREFIXES.some((p) => url.startsWith(p));
}

async function enforceWriteRolesPlugin(app: FastifyInstance): Promise<void> {
  if (authDisabled()) return; // no-op in dev — dev user is admin anyway
  app.addHook('preHandler', async (req, reply) => {
    if (!isProtectedWrite(req)) return;
    if (!req.user) return reply.status(401).send({ error: 'Not authenticated' });
    if (req.user.role === 'viewer') {
      return reply.status(403).send({
        error: {
          code: 'WRITE_FORBIDDEN',
          message: 'viewer role cannot mutate artifacts',
        },
      });
    }
  });
}

export default fp(enforceWriteRolesPlugin, { name: 'enforce-write-roles' });
