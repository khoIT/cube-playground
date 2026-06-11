/**
 * Fetches the Cube /meta member catalog (measures + dimensions, physical
 * names) for a game and exposes it as a Set for existence checks.
 *
 * Why: preset memberColumns are shared across every game that resolves the
 * preset's hub cube, but games model different fields (e.g. only jus has
 * `mf_users.ingame_name`). A single unknown member 400s the WHOLE base
 * member-columns query and blanks every column — so columns must be validated
 * against /meta before they're queried.
 *
 * Returns:
 *  - null            while meta is loading (callers should defer querying)
 *  - 'unavailable'   when meta failed (callers fall back to unfiltered)
 *  - Set<string>     of member names (physical, e.g. `ballistar_mf_users.ltv`)
 */

import { useEffect, useState } from 'react';
import { useAppContext } from '../../../../hooks';
import { useSecurityContext } from '../../../../hooks/security-context';
import { useCubejsApi } from '../../../../hooks/cubejs-api';
import { useWorkspaceContext } from '../../../../components/workspace-context';

export type CubeMetaMembers = Set<string> | 'unavailable' | null;

interface MetaCubeShape {
  name: string;
  measures?: Array<{ name: string }>;
  dimensions?: Array<{ name: string }>;
}

/** meta() responses are stable per (workspace, game) for a session — cache the
 *  in-flight promise so tab remounts and pagination don't refetch. */
const metaCache = new Map<string, Promise<Set<string>>>();

export function useCubeMetaMembers(gameId: string | null): CubeMetaMembers {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const { workspaceId } = useWorkspaceContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null, gameId);
  const [members, setMembers] = useState<CubeMetaMembers>(null);

  useEffect(() => {
    if (!cubejsApi) return;
    let cancelled = false;
    const key = `${workspaceId ?? ''}::${gameId ?? ''}`;
    let promise = metaCache.get(key);
    if (!promise) {
      promise = cubejsApi.meta().then((meta) => {
        const cubes = (meta as unknown as { cubes?: MetaCubeShape[] }).cubes ?? [];
        const out = new Set<string>();
        for (const cube of cubes) {
          for (const m of cube.measures ?? []) out.add(m.name);
          for (const d of cube.dimensions ?? []) out.add(d.name);
        }
        return out;
      });
      metaCache.set(key, promise);
    }
    promise.then(
      (set) => { if (!cancelled) setMembers(set); },
      () => {
        // Failed fetches must not poison the cache or hide all columns.
        metaCache.delete(key);
        if (!cancelled) setMembers('unavailable');
      },
    );
    return () => { cancelled = true; };
  }, [cubejsApi, workspaceId, gameId]);

  return members;
}
