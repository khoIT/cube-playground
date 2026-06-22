/**
 * Verify a Keycloak id_token presented by the browser.
 *
 * Flow (keycloak-js front door):
 *   1. Browser runs keycloak-js, completes the OIDC + PKCE login against the
 *      realm (brokered to the SAML IdP).
 *   2. keycloak-js holds the id_token in memory and POSTs it to
 *      /api/auth/keycloak/session.
 *   3. This module verifies the id_token's SIGNATURE against the realm JWKS
 *      before any claim is trusted, then the route runs the default-deny DB
 *      check and mints the app JWT.
 *
 * Signature verification is mandatory here: unlike the old server-side code
 * exchange, the token now arrives from the untrusted client. Skipping the
 * JWKS check would let any caller forge `email`/`sub` claims and be promoted
 * by the DB access lookup. We verify issuer + audience + signature.
 */

import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';

export interface KeycloakClaims extends JWTPayload {
  sub: string;
  preferred_username?: string;
  email?: string;
  realm_access?: { roles?: string[] };
  /** Group-membership claim; with `full.path=true` looks like `["/games/cfm_vn"]`. */
  groups?: string[];
}

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set for Keycloak id_token verification`);
  return v;
}

// Cache the remote JWKS per certs URI. createRemoteJWKSet keeps its own
// in-memory key cache + handles rotation, so we only rebuild when the URI
// changes (i.e. realm/host reconfigured at runtime — effectively never).
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJwksUri = '';

function jwksForUri(uri: string): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks && cachedJwksUri === uri) return cachedJwks;
  cachedJwks = createRemoteJWKSet(new URL(uri));
  cachedJwksUri = uri;
  return cachedJwks;
}

/**
 * Verify the id_token against the realm JWKS and return its claims. Throws on
 * any signature / issuer / audience / expiry failure (caller maps to 401).
 */
export async function verifyKeycloakIdToken(idToken: string): Promise<KeycloakClaims> {
  const kcUrl = envOrThrow('KEYCLOAK_URL').replace(/\/+$/, '');
  const realm = envOrThrow('KEYCLOAK_REALM');
  const clientId = envOrThrow('KEYCLOAK_CLIENT_ID');

  // KC emits the realm name verbatim in `iss` (no URL-encoding).
  const issuer = `${kcUrl}/realms/${realm}`;
  const jwksUri = `${issuer}/protocol/openid-connect/certs`;

  const { payload } = await jwtVerify(idToken, jwksForUri(jwksUri), {
    issuer,
    audience: clientId,
  });
  return payload as KeycloakClaims;
}
