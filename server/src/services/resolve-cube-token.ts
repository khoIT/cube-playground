/**
 * Resolves the Cube JWT to use for a server-side request to Cube.
 *
 * Workspace-aware (`authMode`):
 *   - `none`        → no token (open prod cube-dev). Returns null + source 'none'.
 *   - `minted`      → mint HS256 via `CUBEJS_API_SECRET`; per-game `securityContext.game`.
 *   - `env-token`   → `CUBE_TOKEN_<WS>_<GAME>` → `CUBE_TOKEN_<WS>` → null.
 *
 * Legacy resolver (no ws ctx) keeps the original env order for backwards-compat
 * with anomaly-detector, drift-resolver and other server-side callers that
 * haven't been migrated to per-workspace ctx yet.
 *
 *   1. `CUBE_TOKEN_<GAME>` env var — pre-minted, operator-controlled.
 *   2. `CUBEJS_API_SECRET` env var — mint a fresh HS256 token in-process
 *      (`{ game, userId: 'playground' }`). Matches the contract Cube enforces
 *      in `cube-dev/cube/cube.js#checkAuth`.
 *   3. `CUBE_TOKEN` env var — last-resort fallback for legacy single-token
 *      deployments.
 *   4. `null` — no token available; caller should skip the request.
 */

import { signCubeToken } from './sign-cube-token.js';
import type { WorkspaceDef } from './workspaces-config-loader.js';

export type CubeTokenSource = 'env' | 'minted' | 'fallback' | 'none';

export interface ResolvedCubeToken {
  token: string | null;
  source: CubeTokenSource;
}

function envKeyFor(gameId: string): string {
  return `CUBE_TOKEN_${gameId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function envKeyForWorkspaceGame(workspaceId: string, gameId: string): string {
  const ws = workspaceId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const game = gameId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `CUBE_TOKEN_${ws}_${game}`;
}

function envKeyForWorkspace(workspaceId: string): string {
  const ws = workspaceId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `CUBE_TOKEN_${ws}`;
}

// Cube's checkAuth resolves the JWT's userId against the auth-users DB. The
// playground is a single service-account principal — `playground` by default,
// overridable for environments that seed a different id.
function playgroundUserId(): string {
  return process.env.CUBE_PLAYGROUND_USER_ID || 'playground';
}

/**
 * Extended resolver — returns both the token and how it was obtained, so
 * callers (and the route) can surface diagnostic info without exposing
 * secrets.
 */
export function resolveCubeTokenForGameDetailed(
  gameId: string,
): ResolvedCubeToken {
  const perGame = process.env[envKeyFor(gameId)];
  if (perGame && perGame.length > 0) {
    return { token: perGame, source: 'env' };
  }

  const secret = process.env.CUBEJS_API_SECRET;
  if (secret && secret.length > 0) {
    const token = signCubeToken(
      { game: gameId, userId: playgroundUserId() },
      secret,
    );
    return { token, source: 'minted' };
  }

  const fallback = process.env.CUBE_TOKEN;
  if (fallback && fallback.length > 0) {
    return { token: fallback, source: 'fallback' };
  }

  return { token: null, source: 'none' };
}

/**
 * Backwards-compatible thin wrapper for existing callers (e.g. anomaly-detector)
 * that just want the bare string-or-null.
 */
export function resolveCubeTokenForGame(gameId: string): string | null {
  return resolveCubeTokenForGameDetailed(gameId).token;
}

/**
 * Workspace-aware resolver. Switches on `workspace.authMode`:
 *   - `none`      → null token (no Authorization header sent).
 *   - `minted`    → HS256 mint via CUBEJS_API_SECRET, per-game claim.
 *   - `env-token` → env var CUBE_TOKEN_<WS>_<GAME> → CUBE_TOKEN_<WS> → null.
 *
 * `gameId` may be null for workspace-level calls (e.g. `/meta` without a game
 * scope on prod). In that case minted-mode falls back to a `playground`-only
 * claim.
 */
export function resolveCubeTokenForWorkspace(
  workspace: WorkspaceDef,
  gameId: string | null,
  userId?: string,
): ResolvedCubeToken {
  // Prefer the real user's stable key (email) so cube-dev's checkAuth can
  // resolve per-user game access; fall back to the service principal.
  const principal = userId && userId.length > 0 ? userId : playgroundUserId();
  switch (workspace.authMode) {
    case 'none':
      return { token: null, source: 'none' };

    case 'env-token': {
      if (gameId) {
        const perWsGame = process.env[envKeyForWorkspaceGame(workspace.id, gameId)];
        if (perWsGame && perWsGame.length > 0) {
          return { token: perWsGame, source: 'env' };
        }
      }
      const perWs = process.env[envKeyForWorkspace(workspace.id)];
      if (perWs && perWs.length > 0) {
        return { token: perWs, source: 'env' };
      }
      return { token: null, source: 'none' };
    }

    case 'minted': {
      const secret = process.env.CUBEJS_API_SECRET;
      if (!secret || secret.length === 0) {
        // No secret configured (misconfigured/dev). We cannot mint a per-user
        // token here, so fall back to operator-provided env tokens only. We do
        // NOT substitute the service principal for a real user — minting under
        // the user's key requires the secret (handled below).
        if (gameId) return resolveCubeTokenForGameDetailed(gameId);
        const fallback = process.env.CUBE_TOKEN;
        if (fallback) return { token: fallback, source: 'fallback' };
        return { token: null, source: 'none' };
      }
      const claims = gameId
        ? { game: gameId, userId: principal }
        : { userId: principal };
      return { token: signCubeToken(claims, secret), source: 'minted' };
    }
  }
}

export { envKeyFor as __envKeyFor };
