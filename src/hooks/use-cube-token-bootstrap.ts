/**
 * Bootstrap hook — keeps the Cube JWT in sync with the active game.
 *
 * Flow:
 *   1. Wait for GameContext to resolve (`ready === true`).
 *   2. On any `gameId` change, fetch `/api/playground/cube-token?game=<id>`.
 *   3. If a token comes back AND differs from the current one, call
 *      `saveToken(token)` on SecurityContext. The cube API memo
 *      (`useCubejsApi`) rebuilds, so /meta and /load pick up the new claim.
 *
 * The hook is intentionally cautious about overwriting state:
 *   - `null` responses (route unconfigured) leave the existing token alone,
 *     preserving any JWT the user pasted manually via the Security Context
 *     modal.
 *   - Rapid switches are protected with AbortController so a stale response
 *     can't clobber the latest game.
 *   - A ref tracks the last-applied gameId so we don't dispatch redundant
 *     `saveToken` calls on re-renders.
 */

import { useContext, useEffect, useRef, useState } from 'react';

import { cubeTokenClient } from '../api/cube-token-client';
import { useGameContext } from '../components/Header/use-game-context';
import { SecurityContextContext } from '../components/SecurityContext/SecurityContextProvider';

export interface CubeTokenBootstrapResult {
  /**
   * The gameId for which the current token was minted, or null if no token
   * has been applied yet. Consumers can compare this against their requested
   * gameId to avoid issuing Cube requests with a stale token.
   */
  tokenGame: string | null;
}

export function useCubeTokenBootstrap(): CubeTokenBootstrapResult {
  const { gameId, ready } = useGameContext();
  const sec = useContext(SecurityContextContext);
  const lastAppliedRef = useRef<string | null>(null);
  // Reactive state so consumers re-run effects when the token advances.
  const [tokenGame, setTokenGame] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !gameId) return;
    if (lastAppliedRef.current === gameId) return;

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const resp = await cubeTokenClient.get(gameId, controller.signal);
      if (cancelled) return;
      if (!resp || resp.token == null) return;
      if (resp.token === sec.currentToken) {
        lastAppliedRef.current = gameId;
        setTokenGame(gameId);
        return;
      }
      await sec.saveToken(resp.token);
      lastAppliedRef.current = gameId;
      setTokenGame(gameId);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, ready]);

  return { tokenGame };
}
