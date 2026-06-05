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
import { useAuthUser, useAuth, type AuthUser } from '../../auth/auth-context';
import { readAppToken } from '../../auth/auth-storage';
import { getPref, setPref, subscribe } from '../../hooks/server-prefs-store';
import { GAME_STORAGE_KEY as STORAGE_KEY, GAME_CHANGE_EVENT } from './active-game-storage';

const FALLBACK_GAME: GameDef = { id: 'ballistar', name: 'Ballistar', mark: 'BS' };

/**
 * Narrow a game pool to the ACTIVE workspace's grant. Applied for real auth with
 * a resolved workspace id only — fail-closed: no grant in that workspace yields
 * an empty pool. Dev (isRealAuth=false) or an unresolved workspace id passes
 * through (the dev loop never strands the picker; first paint doesn't flash
 * empty). Admins bypass narrowing entirely — they administer the grant rows, so
 * gating them on those rows would hide the picker from a fresh admin (mirrors
 * the server's userCanAccessGame admin bypass). Exported so the narrowing is
 * unit-tested against the real logic.
 */
export function narrowGamesByWorkspaceGrant<T extends { id: string }>(
  pool: T[],
  isRealAuth: boolean,
  workspaceId: string,
  authUser: Pick<AuthUser, 'role' | 'gamesByWorkspace'> | null,
): T[] {
  if (!isRealAuth || !workspaceId) return pool;
  if (authUser?.role === 'admin') return pool;
  const grantedHere = new Set(authUser?.gamesByWorkspace?.[workspaceId] ?? []);
  return pool.filter((g) => grantedHere.has(g.id));
}

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
  gameId: 'ballistar',
  games: [FALLBACK_GAME],
  defaultGameId: 'ballistar',
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
  // localStorage mirror maintained by the server-pref store.
  return getPref(STORAGE_KEY);
}

function persistGameId(id: string): void {
  // DB-authoritative write-through (server per owner + localStorage mirror).
  setPref(STORAGE_KEY, id);
}

export function GameContextProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<GamesConfig>({
    defaultGameId: 'ballistar',
    games: [FALLBACK_GAME],
  });
  const [gameId, setGameIdState] = useState<string>('ballistar');
  const [ready, setReady] = useState(false);

  // Workspace tracking — fetched independently of WorkspaceProvider so we can
  // scope the visible game list per workspace (prod-only games hidden on local,
  // local-only games hidden on prod, etc.).
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>(
    () => readPersistedWorkspaceId() ?? '',
  );
  // Per-game availability in the active workspace (games whose Cube schema
  // resolves). `null` = not yet loaded / fetch failed → pass-through (show all)
  // so the picker never blocks or wrongly hides on a flaky readiness call.
  const [readyGameIds, setReadyGameIds] = useState<Set<string> | null>(null);

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

  // Server-pref hydration (or another tab) can update the active game from
  // another device. Reflect it when the id is valid for the loaded config.
  useEffect(() => {
    return subscribe(STORAGE_KEY, (next) => {
      if (next && config.games.some((g) => g.id === next)) {
        setGameIdState((prev) => (prev === next ? prev : next));
      }
    });
  }, [config.games]);

  // Fetch the workspace registry once + listen for workspace-change events so
  // the GamePicker reacts when the user flips the topbar workspace pill.
  useEffect(() => {
    let cancelled = false;
    // Carry the app JWT so the server applies the per-user workspace grant
    // filter (see workspace-context.tsx) — otherwise this hook's own fallback
    // could re-select a workspace the user isn't granted (e.g. `local`).
    const token = readAppToken();
    fetch('/api/workspaces', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
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

  // Fetch per-game readiness for the active workspace so games that don't
  // resolve there (prod-only games on local, etc.) drop out of the picker.
  // Fail-open: any failure leaves readyGameIds null → no narrowing.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    // Reset to pass-through while the new workspace's readiness loads so we
    // don't apply the previous workspace's allow-set to this one.
    setReadyGameIds(null);
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/games-readiness`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((body: { games?: Array<{ id: string; status: string }> }) => {
        if (cancelled) return;
        const ready = new Set(
          (body?.games ?? []).filter((g) => g.status === 'ok').map((g) => g.id),
        );
        // Empty set (e.g. meta unreachable for every game) is treated as
        // "unknown" → pass-through, rather than hiding every game.
        setReadyGameIds(ready.size > 0 ? ready : null);
      })
      .catch(() => {
        if (!cancelled) setReadyGameIds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Filter games by what the active workspace supports AND what this user is
  // granted IN THAT WORKSPACE (per-workspace grants, fail-closed):
  //   - gameModel='prefix' (prod): only games whose id is in `gamePrefixMap`.
  //   - gameModel='game_id' (local): every game in gds.config.json.
  //   - Real auth: intersect with the ACTIVE workspace's grant
  //     (`gamesByWorkspace[workspaceId]`). Empty/absent ⇒ NO games (fail-closed).
  //   - AUTH_DISABLED dev: never narrow by grant (dev sees all).
  //   - Active workspace id not resolved yet: skip grant narrowing so the first
  //     paint doesn't flash empty (mirrors the readyGameIds null-guard).
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
  const authUser = useAuthUser();
  const { state: authState } = useAuth();
  const isRealAuth = authState.status === 'authenticated';
  const visibleGames = useMemo(() => {
    let pool = config.games;
    if (activeWorkspace) {
      if (activeWorkspace.gameModel === 'prefix') {
        const allowed = new Set(Object.keys(activeWorkspace.gamePrefixMap ?? {}));
        pool = pool.filter((g) => allowed.has(g.id));
      }
    }
    // Per-workspace grant narrowing — real auth only, once the active workspace
    // id has resolved. Fail-closed: no grant in this workspace ⇒ empty pool.
    pool = narrowGamesByWorkspaceGrant(pool, isRealAuth, workspaceId, authUser);
    // Drop games that don't resolve in this workspace's Cube schema. null =
    // readiness not loaded yet / failed → pass-through (keep all).
    if (readyGameIds) {
      pool = pool.filter((g) => readyGameIds.has(g.id));
    }
    return pool;
  }, [config.games, activeWorkspace, authUser, isRealAuth, workspaceId, readyGameIds]);

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
        window.dispatchEvent(new CustomEvent(GAME_CHANGE_EVENT, { detail: { gameId: id } }));
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
