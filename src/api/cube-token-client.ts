/**
 * Thin client for the playground server's per-game Cube token endpoint.
 *
 *   GET /api/playground/cube-token?game=<id>
 *     200 { token: string | null, source: 'env' | 'minted' | 'fallback' | 'none' }
 *     404 if game unknown
 *
 * Goes through `apiFetch` so the active `x-cube-workspace` header rides along:
 * the server resolves the mint mode (minted/none/env-token) from the workspace,
 * so without that header the token is resolved against the server's DEFAULT
 * workspace, not the one the SPA is on. That mismatch is invisible when the
 * default already matches the active workspace (the host dev server defaults to
 * `local`), but on the prod-mirror stack the default is `prod` (authMode=none →
 * null token) while the user is on `local` (minted) — yielding a null token and
 * an endlessly-spinning builder. apiFetch also forwards `x-cube-game`.
 *
 * Network failures and 404s degrade to `null` so the bootstrap hook can
 * gracefully skip updating SecurityContext — preserving any token the user
 * pasted manually via the Security Context modal.
 */

import { apiFetch } from './api-client';

export type CubeTokenSource = 'env' | 'minted' | 'fallback' | 'none';

export interface CubeTokenResponse {
  token: string | null;
  source: CubeTokenSource;
}

export const cubeTokenClient = {
  async get(gameId: string, signal?: AbortSignal): Promise<CubeTokenResponse | null> {
    if (!gameId) return null;
    try {
      return await apiFetch<CubeTokenResponse>('/api/playground/cube-token', {
        query: { game: gameId },
        signal,
      });
    } catch {
      return null;
    }
  },
};
