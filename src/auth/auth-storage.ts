/**
 * App-JWT storage seam.
 *
 * The token comes from /api/auth/keycloak/session and is sent on every
 * subsequent request as `Authorization: Bearer <jwt>`. We persist it in
 * localStorage so a page reload doesn't kick the user back to Keycloak.
 *
 * Per the project's "no localStorage for data" rule (see CLAUDE.md): an
 * AUTH TOKEN is not data — it's a session credential. The reference
 * (duongnt5) follows the same pattern.
 */

const STORAGE_KEY = 'gds-cube:app-jwt';

export function readAppToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Authorization header value for the workspace Cube proxy (`/cube-api`).
 *
 * The proxy is server-authoritative: it DROPS this header before calling Cube
 * upstream (it mints its own token from the workspace + game headers) and reads
 * it ONLY to identify the requesting user — which drives per-user query
 * telemetry attribution. So the proxy wants the app JWT here, not the Cube API
 * token. Falls back to the Cube token when no app JWT exists (AUTH_DISABLED dev
 * or pre-login), preserving the legacy direct-to-Cube posture.
 */
export function cubeProxyAuthorization(cubeToken: string | null | undefined): string {
  const appToken = readAppToken();
  if (appToken) return `Bearer ${appToken}`;
  return cubeToken ?? '';
}

export function writeAppToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // ignore quota / privacy errors
  }
}

export function clearAppToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / privacy errors
  }
}
