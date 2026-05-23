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

export function getOwnerId(): string {
  try {
    return window.localStorage.getItem('gds-cube:owner') ?? 'dev';
  } catch {
    return 'dev';
  }
}
