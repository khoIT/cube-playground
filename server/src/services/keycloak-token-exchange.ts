/**
 * Server-side OIDC authorization-code exchange with Keycloak.
 *
 * Flow:
 *   1. Browser hits /api/auth/keycloak/config → gets KC auth URL + client id.
 *   2. Browser redirects to KC, user logs in, KC redirects back to FE with
 *      `?code=...&state=...`.
 *   3. FE POSTs `{ code, redirectUri, codeVerifier? }` to the callback route.
 *   4. Server calls `exchangeKeycloakCode` (this module): POST to KC's
 *      `/token` endpoint, returns the parsed claims of the access token.
 *   5. Server upserts the user, mints app JWT, hands it back to the FE.
 *
 * KC access tokens are JWS-signed. We trust them as "freshly received" here
 * (matches reference); a production hardening pass would verify against
 * KEYCLOAK_URL/realms/$REALM/protocol/openid-connect/certs (JWKS) — left as
 * a follow-up because this token is consumed exactly once, server-side,
 * over the same TLS channel that just issued it.
 */

import { decodeJwt } from 'jose';

export interface KeycloakClaims {
  sub: string;
  preferred_username?: string;
  email?: string;
  realm_access?: { roles?: string[] };
  /**
   * Group-membership claim (configured in realm-export protocol mapper).
   * With `full.path=true` it's an array like `["/games/ballistar", "/games/cfm_vn"]`.
   */
  groups?: string[];
}

export interface ExchangeArgs {
  code: string;
  redirectUri: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  /**
   * Present when scope=openid. We prefer the id_token for identity claims —
   * KC 26 ships "lightweight" access tokens by default and drops `sub` from
   * them. The id_token always carries sub + the configured group/role
   * mappers.
   */
  id_token?: string;
}

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set for Keycloak token exchange`);
  return v;
}

export async function exchangeKeycloakCode({ code, redirectUri }: ExchangeArgs): Promise<KeycloakClaims> {
  const kcUrl = envOrThrow('KEYCLOAK_URL').replace(/\/+$/, '');
  const realm = envOrThrow('KEYCLOAK_REALM');
  const clientId = envOrThrow('KEYCLOAK_CLIENT_ID');
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const tokenUrl = `${kcUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Keycloak token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as TokenResponse;
  // Prefer id_token; some KC setups omit identity claims (sub, etc.) from
  // the access_token. Fall back to access_token so non-OIDC realms still work.
  const identityToken = json.id_token ?? json.access_token;
  return decodeJwt(identityToken) as KeycloakClaims;
}

/**
 * Map KC realm roles to the app role enum. Picks the highest privilege
 * the user has — matches the reference's `_resolve_kc_role` pattern.
 * Returns 'viewer' if no app role is present (KC default behaviour).
 */
export function resolveAppRole(roles: string[] | undefined): 'viewer' | 'editor' | 'admin' {
  const set = new Set(roles ?? []);
  if (set.has('admin')) return 'admin';
  if (set.has('editor')) return 'editor';
  return 'viewer';
}

/**
 * Strip the `/games/` prefix from KC group paths. With `full.path=true` the
 * groups claim looks like `["/games/ballistar", "/games/cfm_vn"]`; we want
 * the bare game ids for matching against `gds.config.json`.
 */
export function extractAllowedGames(groups: string[] | undefined): string[] {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => {
      const m = /^\/games\/([^/]+)$/.exec(g);
      return m ? m[1] : null;
    })
    .filter((g): g is string => !!g);
}
