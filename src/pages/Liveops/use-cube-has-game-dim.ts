/**
 * useCubeHasGameDim — meta-driven predicate for game-dimension presence.
 *
 * Mirrors the pattern in QueryBuilderContainer.tsx:151-168.
 * Probes `cubejsApi.meta.cubes` (the already-resolved sync metadata cache on
 * the Cube client) and returns `true` only when the live schema lists a
 * dimension named `<cube>.gameId` for that cube.
 *
 * Today every game's schema is routed by JWT (`cube.js` per-game model dirs),
 * so no cube exposes a `.gameId` dimension → predicate always returns false →
 * applyGameFilter is a no-op → JWT scoping does the real work. If the backend
 * ever adds a `gameId` dimension to a cube, this hook picks it up automatically
 * without any code change here.
 */

import { useMemo } from 'react';

export function useCubeHasGameDim(
  cubejsApi: unknown,
): (cube: string) => boolean {
  return useMemo(() => {
    let cache: Set<string> | null = null;

    return (cube: string): boolean => {
      if (!cache) {
        // Access the sync metadata cache on the Cube client (same cast as
        // QueryBuilderContainer.tsx — unavoidable without upstream typing).
        const metaCubes = (cubejsApi as any)?.meta?.cubes ?? null;
        if (!metaCubes) return false;

        cache = new Set<string>();
        for (const c of metaCubes as Array<{ dimensions?: Array<{ name?: string }> }>) {
          for (const d of c.dimensions ?? []) {
            if (typeof d?.name === 'string' && d.name.endsWith('.gameId')) {
              cache.add(d.name.split('.')[0]);
            }
          }
        }
      }
      return cache.has(cube);
    };
  // Rebuild when the api instance changes (new token → new client).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cubejsApi]);
}
