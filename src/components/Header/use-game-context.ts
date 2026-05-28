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
import {
  readPersistedWorkspaceId,
  WORKSPACE_CHANGE_EVENT,
} from '../workspace-context';

const STORAGE_KEY = 'gds-cube:active-game';
const FALLBACK_GAME: GameDef = { id: 'ptg', name: 'Play Together', mark: 'PT' };

// Subset of WorkspaceDef needed for filtering. Fetched directly here (instead of
// reading via useWorkspaceContext) because GameContextProvider mounts ABOVE
// WorkspaceProvider in the provider tree — see src/index.tsx + src/App.tsx.
interface WorkspaceSummary {
  id: string;
  gameModel: 'game_id' | 'prefix';
  gamePrefixMap?: Record<string, string>;
  isDefault: boolean;
}

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

  // Workspace tracking — fetched independently of WorkspaceProvider so we can
  // scope the visible game list per workspace (prod-only games hidden on local,
  // local-only games hidden on prod, etc.).
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>(
    () => readPersistedWorkspaceId() ?? '',
  );

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

  // Fetch the workspace registry once + listen for workspace-change events so
  // the GamePicker reacts when the user flips the topbar workspace pill.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((body: { workspaces: WorkspaceSummary[] }) => {
        if (cancelled) return;
        const list = Array.isArray(body?.workspaces) ? body.workspaces : [];
        setWorkspaces(list);
        if (!workspaceId || !list.some((w) => w.id === workspaceId)) {
          const fallback = list.find((w) => w.isDefault)?.id ?? list[0]?.id ?? '';
          if (fallback) setWorkspaceId(fallback);
        }
      })
      .catch(() => {
        // Workspaces endpoint missing — fall through and keep all games visible.
      });

    function onWorkspaceChange(e: Event) {
      const detail = (e as CustomEvent<{ workspaceId?: string }>).detail;
      if (detail?.workspaceId) setWorkspaceId(detail.workspaceId);
    }
    window.addEventListener(WORKSPACE_CHANGE_EVENT, onWorkspaceChange);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKSPACE_CHANGE_EVENT, onWorkspaceChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter games by what the active workspace supports:
  //   - gameModel='prefix' (prod): only games whose id is in `gamePrefixMap`.
  //   - gameModel='game_id' (local): all games (Cube scopes by schema upstream).
  //   - No workspace info yet: pass-through to avoid blocking initial render.
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
  const visibleGames = useMemo(() => {
    if (!activeWorkspace) return config.games;
    if (activeWorkspace.gameModel === 'prefix') {
      const allowed = new Set(Object.keys(activeWorkspace.gamePrefixMap ?? {}));
      return config.games.filter((g) => allowed.has(g.id));
    }
    return config.games;
  }, [config.games, activeWorkspace]);

  // If the active game isn't supported by the new workspace, fall back to the
  // first visible one. Skips while still bootstrapping so we don't clobber a
  // valid stored choice on the very first render.
  useEffect(() => {
    if (!ready || visibleGames.length === 0) return;
    if (visibleGames.some((g) => g.id === gameId)) return;
    const next = visibleGames[0].id;
    setGameIdState(next);
    persistGameId(next);
  }, [visibleGames, gameId, ready]);

  const setGameId = useCallback(
    (id: string) => {
      // Accept any id present in the underlying config — the workspace filter
      // is enforced separately so a programmatic switch (deep-link, restore)
      // doesn't get silently dropped if the workspace-fetch hasn't landed yet.
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
      games: visibleGames,
      defaultGameId: config.defaultGameId,
      setGameId,
      ready,
    }),
    [gameId, visibleGames, config.defaultGameId, setGameId, ready],
  );

  return createElement(GameContext.Provider, { value }, children);
}

export function useGameContext(): GameContextValue {
  return useContext(GameContext);
}

export function useActiveGameId(): string {
  return useContext(GameContext).gameId;
}
