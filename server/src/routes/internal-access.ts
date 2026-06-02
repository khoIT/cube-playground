/**
 * Internal service-to-service access lookup for cube-dev's `checkAuth`.
 *
 *   GET /internal/access/:key   (key = lowercased email = the Cube JWT userId)
 *     200 { role, allowedGames, status }   — active user
 *     404 { error: 'not_found' }           — unknown/inactive → cube-dev denies
 *
 * Guarded by a shared secret (`CUBE_AUTH_INTERNAL_SECRET`) in the
 * `x-internal-secret` header. NEVER exposed to browsers — network policy +
 * secret. If the secret is unset on this process, the route 503s so a
 * misconfigured deploy fails loud instead of leaking grants.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getAccess, normalizeEmail } from '../auth/access-store.js';

function authDisabled(): boolean {
  const raw = (process.env.AUTH_DISABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

async function internalSecretGate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Break-glass: with auth off the whole app runs as a synth admin (see
  // authenticate.ts) and the SSO wall is down. Open this bridge to match, so
  // the in-stack cube's checkAuth resolves the same way local dev does — the
  // handler returns an all-games admin below. Skipping the secret gate is safe
  // here precisely because the deploy already chose to disable authz.
  if (authDisabled()) return;
  const expected = process.env.CUBE_AUTH_INTERNAL_SECRET ?? '';
  if (!expected) {
    reply.status(503).send({ error: 'internal_secret_not_configured' });
    return;
  }
  const provided = req.headers['x-internal-secret'];
  if (typeof provided !== 'string' || provided !== expected) {
    reply.status(401).send({ error: 'invalid_internal_secret' });
    return;
  }
}

export default async function internalAccessRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { key: string } }>(
    '/internal/access/:key',
    { preHandler: internalSecretGate },
    async (req, reply) => {
      // Auth off → resolve every principal as an all-games admin, mirroring the
      // server's synth admin. '*' is a wildcard the cube's checkAuth expands to
      // all supported tenants, so we don't have to translate game-id vocab
      // (gds.config `cfm_vn` vs cube canonical `cfm`) here. Unreachable when
      // AUTH_DISABLED is unset/false.
      if (authDisabled()) {
        return { role: 'admin', allowedGames: ['*'], status: 'active' };
      }
      const key = normalizeEmail(req.params.key);
      const access = getAccess(key);
      // Fail closed: only active users resolve; everything else is "no access".
      if (!access || access.status !== 'active') {
        return reply.status(404).send({ error: 'not_found' });
      }
      return { role: access.role, allowedGames: access.games, status: access.status };
    },
  );
}
