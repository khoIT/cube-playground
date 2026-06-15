/**
 * Global write-method RBAC gate for artifact routes.
 *
 * Rather than sprinkling `requireRole('editor','admin')` on every POST /
 * PUT / PATCH / DELETE handler, this preHandler runs once per request and
 * blocks viewer-role mutations on the artifact prefixes below.
 *
 * Artifacts are SHARED within a workspace, so write access is gated by role
 * only (viewer blocked; editor/admin allowed) — there is intentionally no
 * per-row ownership check: any editor may modify any segment/dashboard in the
 * workspace. The `owner` column records provenance, not a write boundary.
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
  // Glossary and concept routes carry durable org-wide artifacts; viewers
  // may read but must not mutate (POST/PUT/PATCH/DELETE).
  '/api/glossary',
  '/api/concepts',
  // VIP-care: viewers may read the monitor/ledger (GET) but must not mutate the
  // case ledger (PATCH treatment/status) or author playbooks (Phase-6 writes).
  '/api/care',
  // Advisor: /diagnose + /recommend are read-only POSTs (they carry a body but
  // mutate nothing) and stay open to viewers. Only scaffolding a hand-off draft
  // and recording dismiss/pin feedback are mutations — gate those sub-paths.
  '/api/advisor/handoff',
  '/api/advisor/feedback',
  // The agent turn spawns a paid LLM investigation loop — a write-class action,
  // not a free read like /diagnose. Gate it to write roles.
  '/api/advisor/agent/turn',
  // Experiments are durable shared artifacts: create/patch a draft and freezing
  // the arm assignment are write-class. Viewers may read the list/scorecard (GET)
  // but must not create or freeze an experiment.
  '/api/experiments',
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
