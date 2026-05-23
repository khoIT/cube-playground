/**
 * Resolves the Cube JWT to use for a server-side request to Cube.
 *
 * Resolution order:
 *   1. `CUBE_TOKEN_<GAME>` env var — pre-minted, operator-controlled.
 *   2. `CUBEJS_API_SECRET` env var — mint a fresh HS256 token in-process
 *      (`{ game, userId: 'playground' }`). Matches the contract Cube enforces
 *      in `cube-dev/cube/cube.js#checkAuth`.
 *   3. `CUBE_TOKEN` env var — last-resort fallback for legacy single-token
 *      deployments.
 *   4. `null` — no token available; caller should skip the request.
 *
 * The env-var key is derived from the game id uppercased, with non-alnum
 * chars replaced by `_` (so `cfm_vn` → `CUBE_TOKEN_CFM_VN`).
 */

import { signCubeToken } from './sign-cube-token.js';

export type CubeTokenSource = 'env' | 'minted' | 'fallback' | 'none';

export interface ResolvedCubeToken {
  token: string | null;
  source: CubeTokenSource;
}

function envKeyFor(gameId: string): string {
  return `CUBE_TOKEN_${gameId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
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
      { game: gameId, userId: 'playground' },
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

export { envKeyFor as __envKeyFor };
