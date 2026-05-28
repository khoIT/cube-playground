/**
 * HS256 JWT signer for Cube. Matches the contract enforced by
 * `cube-dev/cube/cube.js#checkAuth`: payload must carry `game` and `userId`,
 * signed with `CUBEJS_API_SECRET`.
 *
 * We sign in-process (no `jsonwebtoken` dep) to keep the server's runtime
 * dependency surface minimal. The format is the standard JOSE compact
 * serialisation: `base64url(header).base64url(payload).base64url(hmac)`.
 */

import { createHmac } from 'node:crypto';

export interface CubeTokenPayload {
  /** Optional — omitted for workspace-level (game-less) calls. */
  game?: string;
  userId: string;
  iat?: number;
  exp?: number;
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Sign an HS256 JWT for the given payload. `iat` is auto-filled if missing.
 * The caller is responsible for setting `exp` if a finite lifetime is desired.
 */
export function signCubeToken(payload: CubeTokenPayload, secret: string): string {
  if (!secret) {
    throw new Error('sign-cube-token: secret is empty');
  }
  const header = { alg: 'HS256', typ: 'JWT' };
  // Preserve caller-supplied key order; only auto-fill `iat` when absent so a
  // pre-built reference (with iat as the last field) can be reproduced byte-
  // for-byte.
  const full: CubeTokenPayload =
    payload.iat == null
      ? { ...payload, iat: Math.floor(Date.now() / 1000) }
      : payload;
  const headerSeg = base64UrlEncode(JSON.stringify(header));
  const payloadSeg = base64UrlEncode(JSON.stringify(full));
  const signingInput = `${headerSeg}.${payloadSeg}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(sig)}`;
}
