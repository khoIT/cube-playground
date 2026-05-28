/**
 * App-JWT storage seam.
 *
 * The token comes from /api/auth/keycloak/callback and is sent on every
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
