/**
 * Thin client for the playground server's per-game Cube token endpoint.
 *
 *   GET /api/playground/cube-token?game=<id>
 *     200 { token: string | null, source: 'env' | 'minted' | 'fallback' | 'none' }
 *     404 if game unknown
 *
 * Network failures and 404s degrade to `null` so the bootstrap hook can
 * gracefully skip updating SecurityContext — preserving any token the user
 * pasted manually via the Security Context modal.
 */

export type CubeTokenSource = 'env' | 'minted' | 'fallback' | 'none';

export interface CubeTokenResponse {
  token: string | null;
  source: CubeTokenSource;
}

export const cubeTokenClient = {
  async get(gameId: string, signal?: AbortSignal): Promise<CubeTokenResponse | null> {
    if (!gameId) return null;
    try {
      const resp = await fetch(
        `/api/playground/cube-token?game=${encodeURIComponent(gameId)}`,
        { headers: { Accept: 'application/json' }, signal },
      );
      if (!resp.ok) return null;
      return (await resp.json()) as CubeTokenResponse;
    } catch {
      return null;
    }
  },
};
