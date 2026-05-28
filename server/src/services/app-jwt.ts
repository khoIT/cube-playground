/**
 * Sign + verify the application JWT (HS256).
 *
 * This is NOT the Keycloak token — it's a separate token the server mints
 * after a successful KC code-exchange. The FE stores this app JWT in
 * localStorage and sends it as `Authorization: Bearer <jwt>` on every
 * request. `authenticate.ts` verifies it and populates `req.user`.
 *
 * Why mint our own:
 *   - We never expose KC tokens to the browser (matches reference pattern).
 *   - We can embed app-derived fields (allowedGames, owner-id) without
 *     coupling the client to KC token shape.
 *   - Rotation is trivial — change JWT_SECRET and every user re-logs in.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ALG = 'HS256';
const ISSUER = 'cube-playground';

export interface AppJwtClaims extends JWTPayload {
  /** KC `sub` claim — stable id, never the username. */
  sub: string;
  username: string;
  email?: string;
  role: 'viewer' | 'editor' | 'admin';
  /** Game ids the user can access; derived from KC `/games/*` groups. */
  allowedGames: string[];
}

function secretBytes(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error('JWT_SECRET must be set (>=16 chars).');
  }
  return new TextEncoder().encode(raw);
}

function expirySeconds(): number {
  const mins = Number(process.env.JWT_EXPIRES_MINUTES ?? 720);
  return Number.isFinite(mins) && mins > 0 ? mins * 60 : 12 * 60 * 60;
}

export async function signAppJwt(claims: Omit<AppJwtClaims, 'iss' | 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setSubject(String(claims.sub))
    .setIssuedAt()
    .setExpirationTime(`${expirySeconds()}s`)
    .sign(secretBytes());
}

export async function verifyAppJwt(token: string): Promise<AppJwtClaims> {
  const { payload } = await jwtVerify(token, secretBytes(), {
    issuer: ISSUER,
    algorithms: [ALG],
  });
  // Narrow the loose JWTPayload into our typed shape. Trust the issuer here —
  // any tampering would have failed the signature check above.
  return payload as AppJwtClaims;
}
