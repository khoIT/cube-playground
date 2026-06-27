/**
 * API-key preHandler for the public export surface (`/api/public/v1/*`).
 *
 * Applied as a route-plugin-scoped preHandler — NOT a global onRequest — so the
 * app-JWT / workspace-header middleware (which power the FE) never touch this
 * surface, and vice-versa. Reads the key from `Authorization: Bearer sk_live_…`
 * or the `X-API-Key` header, resolves its scope via the store, and decorates the
 * request with `apiKeyScope`. Unknown / revoked / expired → 401 JSON.
 *
 * Never logs the full key — only the non-secret prefix on the resolved scope.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { createHash } from 'node:crypto';
import { verifyKey, touchLastUsed, type ApiKeyScope } from '../auth/api-key-store.js';

/** Non-reversible short fingerprint of a presented key for correlating repeated
 *  bad attempts in logs — NEVER the raw key bytes (logging those would leak a
 *  near-secret if the attempt was a typo of a real key). */
function keyFingerprint(presented: string): string {
  return createHash('sha256').update(presented).digest('hex').slice(0, 12);
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Resolved API-key scope on `/api/public/v1/*` routes (null elsewhere). */
    apiKeyScope?: ApiKeyScope;
  }
}

function extractKey(req: FastifyRequest): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey) return headerKey.trim();
  return null;
}

export const requireApiKey: preHandlerHookHandler = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const presented = extractKey(req);
  if (!presented) {
    // Log only — never a DB row: an unauthenticated caller must not be able to
    // write the audit table (token-spray DoS) nor leak key bytes into it.
    req.log.warn({ evt: 'public_pull_auth_reject', code: 'missing_key', ip: req.ip }, 'public export: missing API key');
    return reply
      .status(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'Missing API key. Send Authorization: Bearer sk_live_…' } });
  }
  const scope = verifyKey(presented);
  if (!scope) {
    req.log.warn(
      { evt: 'public_pull_auth_reject', code: 'invalid_key', fp: keyFingerprint(presented), ip: req.ip },
      'public export: invalid/revoked/expired API key',
    );
    return reply
      .status(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid, revoked, or expired API key.' } });
  }
  req.apiKeyScope = scope;
  // Throttled write (≤1/interval/key) — never on the streamed-page hot path.
  touchLastUsed(scope.id);
};
