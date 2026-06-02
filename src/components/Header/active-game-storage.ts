/**
 * Cycle-free storage glue for the active game id.
 *
 * Split out from use-game-context so non-React callers (api-client's fetch
 * wrapper) can read the active game and attach the x-cube-game header WITHOUT
 * importing the React context module — that import would pull
 * segments-client → api-client into a require cycle.
 *
 * Mirrors the workspace equivalents in workspace-context (WORKSPACE_HEADER /
 * getActiveWorkspaceId): one source of truth for the key, header, and change
 * event, depending only on the prefs store.
 */

import { getPref } from '../../hooks/server-prefs-store';

/** localStorage / server-pref key holding the active game id. */
export const GAME_STORAGE_KEY = 'gds-cube:active-game';

/**
 * Per-request header that scopes a game_id (multi-tenant) workspace to one
 * game. The gateway mints a Cube token carrying this game claim; cube-dev's
 * checkAuth then enforces per-user game access. Omitting it yields a game-less
 * token whose /meta comes back empty on a strict multi-tenant cube — which is
 * why every gateway call must carry it, not just the query path.
 */
export const GAME_HEADER = 'x-cube-game';

/** Dispatched on window when the active game changes (see use-game-context). */
export const GAME_CHANGE_EVENT = 'gds-cube:game-change';

/**
 * Read the active game id without subscribing to React. Used by the fetch
 * wrapper (api-client) to attach x-cube-game on every gateway call, the same
 * way getActiveWorkspaceId attaches x-cube-workspace — so no individual call
 * site can forget to scope itself to the active tenant.
 */
export function getActiveGameId(): string | null {
  return getPref(GAME_STORAGE_KEY);
}
