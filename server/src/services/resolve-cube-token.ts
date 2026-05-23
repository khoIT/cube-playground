/**
 * Resolves the Cube JWT to use for a server-side request to Cube.
 *
 * Server jobs (e.g. anomaly detector) need to query Cube *per game* because
 * `repositoryFactory` keys off `securityContext.game`. The playground does
 * not run a JWT-minting service, so we let deployments configure one token
 * per game via env vars:
 *
 *   CUBE_TOKEN_PTG        — token whose claim is { game: 'ptg' }
 *   CUBE_TOKEN_BALLISTAR  — token for ballistar, etc.
 *   CUBE_TOKEN            — fallback when no per-game token is set
 *
 * The env-var name is derived from the game id uppercased, with non-alnum
 * chars replaced by `_`. Returning `null` means we have no token at all
 * for that game and the caller should skip the request.
 */

function envKeyFor(gameId: string): string {
  return `CUBE_TOKEN_${gameId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export function resolveCubeTokenForGame(gameId: string): string | null {
  const perGame = process.env[envKeyFor(gameId)];
  if (perGame && perGame.length > 0) return perGame;
  const fallback = process.env.CUBE_TOKEN;
  if (fallback && fallback.length > 0) return fallback;
  return null;
}

export { envKeyFor as __envKeyFor };
