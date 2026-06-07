/**
 * Shared helper for the X-Owner-Id header sent on every /api/chat/* request.
 *
 * The chat-service enforces per-owner ownership on session detail/list/patch/
 * delete routes. Without this header the server-side proxy falls back to
 * `anonymous`, which mismatches the owner stored on sessions created with
 * the real id ('dev' by default) and surfaces as 403 (detail) or empty list.
 *
 * Kept in its own module so non-SSE consumers (history hydration hooks,
 * sessions index, rename/delete menus) don't have to import the SSE client
 * just to read the owner id.
 */

// First bootstrap admin — must stay in lockstep with DEFAULT_OWNER in
// api-client.ts and devAdminEmail() on the server (auth/dev-identity.ts).
const DEFAULT_OWNER = 'khoitn@vng.com.vn';

export function getOwnerId(): string {
  try {
    // `|| ` (not `??`) so a stray empty string also falls back to the default.
    // The default and storage key must stay in lockstep with getOwner() in
    // api-client.ts — both read 'gds-cube:owner'; a divergent default makes the
    // app disagree with itself about the caller's identity.
    const stored = window.localStorage.getItem('gds-cube:owner');
    // Migrate the retired 'dev' placeholder (mirrors getOwner()).
    if (stored === 'dev') {
      window.localStorage.removeItem('gds-cube:owner');
      return DEFAULT_OWNER;
    }
    return stored || DEFAULT_OWNER;
  } catch {
    return DEFAULT_OWNER;
  }
}
