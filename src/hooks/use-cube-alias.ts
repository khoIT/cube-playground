import { useCallback, useEffect, useState } from 'react';

export type CubeAlias = {
  displayName?: string;
  icon?: string;
};

type AliasMap = Record<string, CubeAlias>;

const STORAGE_KEY = 'gds-cube:cube-aliases';

function loadMap(): AliasMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AliasMap) : {};
  } catch {
    return {};
  }
}

function persist(map: AliasMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / privacy mode — silently ignore */
  }
}

// Single subscriber set so every hook instance reacts to writes from any tab
// (including the current one) without resorting to a global state library.
type Listener = (next: AliasMap) => void;
const listeners = new Set<Listener>();

function broadcast(next: AliasMap) {
  listeners.forEach((l) => l(next));
}

function getMap(): AliasMap {
  return loadMap();
}

function writeMap(producer: (prev: AliasMap) => AliasMap) {
  const next = producer(loadMap());
  persist(next);
  broadcast(next);
}

export function useCubeAlias(name: string) {
  const [map, setMap] = useState<AliasMap>(getMap);

  useEffect(() => {
    listeners.add(setMap);
    const onStorage = (evt: StorageEvent) => {
      if (evt.key === STORAGE_KEY) setMap(loadMap());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(setMap);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const alias: CubeAlias = map[name] ?? {};

  const update = useCallback(
    (patch: Partial<CubeAlias>) => {
      writeMap((prev) => {
        const next: AliasMap = {
          ...prev,
          [name]: { ...(prev[name] ?? {}), ...patch },
        };
        if (!next[name].displayName && !next[name].icon) {
          delete next[name];
        }
        return next;
      });
    },
    [name],
  );

  const reset = useCallback(() => {
    writeMap((prev) => {
      const { [name]: _drop, ...rest } = prev;
      return rest;
    });
  }, [name]);

  return { alias, update, reset } as const;
}
