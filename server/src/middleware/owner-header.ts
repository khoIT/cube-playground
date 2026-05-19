/**
 * Fastify plugin: extracts X-Owner header and decorates request.owner.
 *
 * v1 auth posture: owner is a plain string from the header, no token validation.
 * All writes are stamped with this value; list queries filter by it unless ?owner=*.
 * Document this as a dev-convenience posture — not production auth.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

// Augment FastifyRequest so TypeScript knows about request.owner everywhere
declare module 'fastify' {
  interface FastifyRequest {
    owner: string;
  }
}

async function ownerHeaderPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('owner', 'anonymous');

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const raw = request.headers['x-owner'];
    request.owner = typeof raw === 'string' && raw.trim() ? raw.trim() : 'anonymous';
  });
}

export default fp(ownerHeaderPlugin, { name: 'owner-header' });
