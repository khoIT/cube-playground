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

async function internalSecretGate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
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
