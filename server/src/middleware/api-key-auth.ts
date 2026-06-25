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
import { verifyKey, touchLastUsed, type ApiKeyScope } from '../auth/api-key-store.js';

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
    return reply
      .status(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'Missing API key. Send Authorization: Bearer sk_live_…' } });
  }
  const scope = verifyKey(presented);
  if (!scope) {
    return reply
      .status(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid, revoked, or expired API key.' } });
  }
  req.apiKeyScope = scope;
  // Throttled write (≤1/interval/key) — never on the streamed-page hot path.
  touchLastUsed(scope.id);
};
