/**
 * Caches the /api/identity-map response in module-level state.
 * Returns { mappings, loading, error, identityFieldFor(cube), hasIdentityFor(cube) }.
 * Refresh is shared across components — a single in-flight promise is reused.
 */

import { useEffect, useState } from 'react';
import { identityMapClient } from '../api/segments-client';
import type { CubeIdentityMapping } from '../types/segment-api';
import { WORKSPACE_CHANGE_EVENT } from '../components/workspace-context';
import { GAME_CHANGE_EVENT } from '../components/Header/active-game-storage';

let cache: CubeIdentityMapping[] | null = null;
let inflight: Promise<CubeIdentityMapping[]> | null = null;
const listeners = new Set<(rows: CubeIdentityMapping[]) => void>();

function fetchIfNeeded(force = false): Promise<CubeIdentityMapping[]> {
  if (!force && cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = identityMapClient
    .list()
    .then((rows) => {
      cache = rows;
      inflight = null;
      listeners.forEach((cb) => cb(rows));
      return rows;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function invalidateIdentityMap(): void {
  cache = null;
}

// When the user switches workspaces the identity map is workspace-specific
// (prod and local expose different physical cube names). Invalidate and
// re-fetch so components with open sessions see the new workspace's map
// without requiring a page reload.
//
// Game changes matter too: on a game_id (multi-tenant) workspace the suggester
// queries the active tenant's /meta, so the resolvable cube set — and thus the
// identity map — differs per game. Treat a game switch the same way.
if (typeof window !== 'undefined') {
  const refresh = () => {
    invalidateIdentityMap();
    fetchIfNeeded(true).catch(() => {
      // Suppress — errors surface through the hook's error state on next render.
    });
  };
  window.addEventListener(WORKSPACE_CHANGE_EVENT, refresh);
  window.addEventListener(GAME_CHANGE_EVENT, refresh);
}

export function useIdentityMap() {
  const [mappings, setMappings] = useState<CubeIdentityMapping[] | null>(cache);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(cache == null);

  useEffect(() => {
    let cancelled = false;
    const onUpdate = (rows: CubeIdentityMapping[]) => {
      if (!cancelled) setMappings(rows);
    };
    listeners.add(onUpdate);

    if (cache != null) {
      setMappings(cache);
      setLoading(false);
    } else {
      fetchIfNeeded()
        .then((rows) => {
          if (!cancelled) {
            setMappings(rows);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err as Error);
            setLoading(false);
          }
        });
    }

    return () => {
      cancelled = true;
      listeners.delete(onUpdate);
    };
  }, []);

  const identityFieldFor = (cube: string): string | null => {
    const row = (mappings ?? []).find((m) => m.cube === cube);
    return row?.identity_field ?? null;
  };

  const hasIdentityFor = (cube: string): boolean => {
    const f = identityFieldFor(cube);
    return f != null && f.length > 0;
  };

  return {
    mappings: mappings ?? [],
    loading,
    error,
    refresh: () => fetchIfNeeded(true),
    identityFieldFor,
    hasIdentityFor,
  };
}
