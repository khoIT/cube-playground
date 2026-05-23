/**
 * Game-context state — app-wide scope for liveops surfaces (segments, catalog,
 * new metric). Provides { gameId, games, setGameId } via React context, plus
 * storage glue: localStorage 'gds-cube:active-game' and ?game= URL override.
 *
 * Consumers: GamePicker (Header), Segments library/list calls, Catalog and
 * NewMetric scoping.
 */

import {
  createContext,
  createElement,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { gamesClient } from '../../api/segments-client';
import type { GameDef, GamesConfig } from '../../types/segment-api';

const STORAGE_KEY = 'gds-cube:active-game';
const FALLBACK_GAME: GameDef = { id: 'ptg', name: 'Play Together', mark: 'PT' };

interface GameContextValue {
  gameId: string;
  games: GameDef[];
  defaultGameId: string;
  setGameId: (id: string) => void;
  ready: boolean;
}

const GameContext = createContext<GameContextValue>({
  gameId: 'ptg',
  games: [FALLBACK_GAME],
  defaultGameId: 'ptg',
  setGameId: () => {},
  ready: false,
});

function readUrlGameId(): string | null {
  if (typeof window === 'undefined') return null;
  // We use hash-based routing — query lives after '?', inside the hash.
  const hash = window.location.hash || '';
  const queryStart = hash.indexOf('?');
  const queryStr =
    queryStart >= 0 ? hash.slice(queryStart + 1) : window.location.search.replace(/^\?/, '');
  if (!queryStr) return null;
  const params = new URLSearchParams(queryStr);
  return params.get('game');
}

function readStoredGameId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistGameId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore quota / private mode */
  }
}

export function GameContextProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<GamesConfig>({
    defaultGameId: 'ptg',
    games: [FALLBACK_GAME],
  });
  const [gameId, setGameIdState] = useState<string>('ptg');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    gamesClient
      .list()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        const url = readUrlGameId();
        const stored = readStoredGameId();
        const valid = (id: string | null) => id && cfg.games.some((g) => g.id === id);
        const resolved = valid(url) ? url! : valid(stored) ? stored! : cfg.defaultGameId;
        setGameIdState(resolved);
        if (resolved !== stored) persistGameId(resolved);
        setReady(true);
      })
      .catch(() => {
        // Offline / config missing — fall back gracefully so the rest of the UI works.
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setGameId = useCallback(
    (id: string) => {
      if (!config.games.some((g) => g.id === id)) return;
      setGameIdState(id);
      persistGameId(id);
      if (typeof window !== 'undefined') {
        // Drop ?query= from the hash so the new tenant's QueryBuilder doesn't
        // boot with cube/dim refs that may not exist in its yaml (Cube returns
        // 400 on unknown members and the builder shows a stale-error toast).
        // The picker remounts QueryTabs via key={gameId}; a clean URL means a
        // clean initial state.
        const hash = window.location.hash || '';
        const qIdx = hash.indexOf('?');
        if (qIdx >= 0) {
          const path = hash.slice(0, qIdx);
          const params = new URLSearchParams(hash.slice(qIdx + 1));
          if (params.has('query')) {
            params.delete('query');
            const remaining = params.toString();
            const nextHash = remaining ? `${path}?${remaining}` : path;
            // replaceState avoids polluting browser history with a "switched
            // game" entry; hashchange fires anyway so React Router updates.
            window.history.replaceState(null, '', nextHash || '#/');
          }
        }
        window.dispatchEvent(new CustomEvent('gds-cube:game-change', { detail: { gameId: id } }));
      }
    },
    [config.games],
  );

  const value = useMemo<GameContextValue>(
    () => ({
      gameId,
      games: config.games,
      defaultGameId: config.defaultGameId,
      setGameId,
      ready,
    }),
    [gameId, config, setGameId, ready],
  );

  return createElement(GameContext.Provider, { value }, children);
}

export function useGameContext(): GameContextValue {
  return useContext(GameContext);
}

export function useActiveGameId(): string {
  return useContext(GameContext).gameId;
}
