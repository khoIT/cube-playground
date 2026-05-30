import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../api/api-client';
import { WORKSPACE_CHANGE_EVENT } from '../components/workspace-context';

/**
 * Cube display aliases (custom name + icon), persisted server-side per
 * `(owner, workspace)` via `/api/cube-aliases`. Replaces the former
 * `gds-cube:cube-aliases` localStorage blob — aliases are user data, must be
 * workspace-isolated (cube names differ across workspaces) and multi-user safe.
 *
 * A module-level store holds the active workspace's alias map and fans changes
 * out to every mounted `useCubeAlias` instance. The map is (re)loaded on first
 * use and whenever the active workspace changes.
 */

export type CubeAlias = {
  displayName?: string;
  icon?: string;
};

type AliasMap = Record<string, CubeAlias>;

type AliasRow = { cube_name: string; alias: string | null; icon: string | null };

const LEGACY_STORAGE_KEY = 'gds-cube:cube-aliases';

let map: AliasMap = {};
let loaded = false;
let loadPromise: Promise<void> | null = null;

type Listener = (next: AliasMap) => void;
const listeners = new Set<Listener>();

function broadcast(): void {
  listeners.forEach((l) => l(map));
}

function rowsToMap(rows: AliasRow[]): AliasMap {
  const next: AliasMap = {};
  for (const r of rows) {
    next[r.cube_name] = {
      displayName: r.alias ?? undefined,
      icon: r.icon ?? undefined,
    };
  }
  return next;
}

/**
 * One-time migration of the pre-server localStorage aliases. Best-effort: push
 * each legacy entry to the active workspace, then drop the key so it never
 * re-imports. Failures are swallowed — the worst case is the user re-sets an
 * alias.
 */
async function importLegacyAliases(): Promise<void> {
  if (typeof window === 'undefined') return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as AliasMap;
    if (parsed && typeof parsed === 'object') {
      await Promise.allSettled(
        Object.entries(parsed).map(([cubeName, a]) =>
          apiFetch(`/api/cube-aliases/${encodeURIComponent(cubeName)}`, {
            method: 'PUT',
            body: { alias: a.displayName ?? null, icon: a.icon ?? null },
          }),
        ),
      );
    }
  } catch {
    /* malformed blob — discard it below */
  }
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function load(): Promise<void> {
  await importLegacyAliases();
  try {
    const rows = await apiFetch<AliasRow[]>('/api/cube-aliases');
    map = rowsToMap(Array.isArray(rows) ? rows : []);
  } catch {
    map = {};
  }
  loaded = true;
  broadcast();
}

function ensureLoaded(): void {
  if (loaded || loadPromise) return;
  loadPromise = load().finally(() => {
    loadPromise = null;
  });
}

/** Reload the map for the active workspace (after a workspace switch). */
function reload(): void {
  loaded = false;
  loadPromise = load().finally(() => {
    loadPromise = null;
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener(WORKSPACE_CHANGE_EVENT, reload);
}

export function useCubeAlias(name: string) {
  const [current, setCurrent] = useState<AliasMap>(map);

  useEffect(() => {
    ensureLoaded();
    listeners.add(setCurrent);
    setCurrent(map);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  const alias: CubeAlias = current[name] ?? {};

  const update = useCallback(
    (patch: Partial<CubeAlias>) => {
      const nextEntry: CubeAlias = { ...(map[name] ?? {}), ...patch };
      const cleared = !nextEntry.displayName && !nextEntry.icon;
      // Optimistic local update so the UI reacts immediately.
      map = { ...map };
      if (cleared) delete map[name];
      else map[name] = nextEntry;
      broadcast();
      // Persist. Empty alias + icon → the route deletes the row.
      void apiFetch(`/api/cube-aliases/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: {
          alias: nextEntry.displayName ?? null,
          icon: nextEntry.icon ?? null,
        },
      }).catch(() => {
        /* best-effort; a reload reconciles with the server */
      });
    },
    [name],
  );

  const reset = useCallback(() => {
    map = { ...map };
    delete map[name];
    broadcast();
    void apiFetch(`/api/cube-aliases/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }).catch(() => {
      /* best-effort */
    });
  }, [name]);

  return { alias, update, reset } as const;
}
