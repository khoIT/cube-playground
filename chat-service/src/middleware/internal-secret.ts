/**
 * Inbound internal-secret gate for the admin telemetry bridge.
 *
 * This is NET-NEW auth: chat-service had no inbound service-token gate, and its
 * public `GET /stats` self-scopes by `x-owner-id`. The admin hub needs cross-
 * user aggregates, so `/internal/stats` is gated by a shared secret instead.
 *
 * UNCONDITIONAL — unlike the main server's `/internal/access`, this gate has NO
 * `AUTH_DISABLED` break-glass branch. The endpoint exposes OTHER users'
 * activity; opening it when auth is disabled would leak cross-user telemetry in
 * exactly the environments where the SSO wall is already down. If the secret is
 * unset, the route 503s (fails loud) rather than running open.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export interface InternalSecretGateOptions {
  /** Override the configured secret (tests). */
  expectedSecret?: string;
}

export function buildInternalSecretGate(
  opts: InternalSecretGateOptions = {},
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const expected = opts.expectedSecret ?? config.internalSecret ?? '';
    if (!expected) {
      reply.status(503).send({ error: 'internal_secret_not_configured' });
      return;
    }
    const provided = req.headers['x-internal-secret'];
    if (typeof provided !== 'string' || provided !== expected) {
      reply.status(401).send({ error: 'invalid_internal_secret' });
      return;
    }
  };
}
