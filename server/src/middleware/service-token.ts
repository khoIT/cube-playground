/**
 * Service-token middleware (decision C2): validates an internal call from
 * chat-service against shared secret env `MAIN_SERVER_SERVICE_TOKEN`.
 *
 *   Authorization: Bearer ${MAIN_SERVER_SERVICE_TOKEN}
 *   X-Owner-Id: <owner-for-audit-attribution>
 *
 * If the token is unset on this process, requests are rejected with 503 so
 * misconfigured environments fail loud instead of silently letting calls
 * through. Mount via `app.addHook` on a per-route basis (do NOT install
 * globally — public client traffic must not hit this hook).
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

export interface ServiceTokenGateOptions {
  /** Override env lookup (tests). */
  expectedToken?: string;
}

export function buildServiceTokenGate(
  opts: ServiceTokenGateOptions = {},
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const expected = opts.expectedToken ?? process.env.MAIN_SERVER_SERVICE_TOKEN ?? '';
    if (!expected) {
      reply.status(503).send({ code: 'service_token_not_configured' });
      return;
    }
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      reply.status(401).send({ code: 'missing_bearer' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (token !== expected) {
      reply.status(401).send({ code: 'invalid_service_token' });
      return;
    }
    // Attribute the call to the owner header (decision C2 — for audit only).
    const ownerHeader = req.headers['x-owner-id'];
    if (typeof ownerHeader === 'string' && ownerHeader.trim()) {
      req.owner = ownerHeader.trim();
    }
  };
}
