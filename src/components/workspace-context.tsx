/**
 * WorkspaceContext — server-side Cube workspace selection.
 *
 * Frontend never sees workspace URLs (SSRF guard). It only knows ids + labels
 * and forwards `x-cube-workspace: <id>` on every API call. Active id is
 * localStorage-persisted; switching dispatches `gds-cube:workspace-change` so
 * surfaces can invalidate caches and refetch meta.
 */

import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getPref, setPref, subscribe } from '../hooks/server-prefs-store';
import { recordWorkspaceSwitch } from '../api/feature-open-beacon';
import { readAppToken } from '../auth/auth-storage';

const WORKSPACE_STORAGE_KEY = 'gds-cube:workspace';
// Fired on the window when the active workspace changes. Subsystems that hold
// workspace-scoped state subscribe to reset/re-scope (see use-active-chat-session,
// QueryBuilderContainer). Re-exported below.
const WORKSPACE_CHANGE_EVENT = 'gds-cube:workspace-change';

export interface WorkspaceDef {
  id: string;
  label: string;
  gameModel: 'game_id' | 'prefix';
  authMode: 'none' | 'minted' | 'env-token';
  gamePrefixMap?: Record<string, string>;
  isDefault: boolean;
}

interface WorkspaceContextValue {
  workspaceId: string;
  workspaces: WorkspaceDef[];
  setWorkspaceId: (id: string) => void;
  ready: boolean;
  /** Current workspace (or null while still bootstrapping). */
  workspace: WorkspaceDef | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function readPersistedWorkspaceId(): string | null {
  // Reads the localStorage mirror maintained by the server-pref store, so
  // synchronous callers (header injection, first paint) stay synchronous.
  return getPref(WORKSPACE_STORAGE_KEY);
}

function persistWorkspaceId(id: string): void {
  // DB-authoritative: writes through to the server (per owner) and the
  // localStorage mirror in one call.
  setPref(WORKSPACE_STORAGE_KEY, id);
}

interface WorkspaceProviderProps {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceDef[]>([]);
  const [ready, setReady] = useState(false);
  const [workspaceId, setWorkspaceIdState] = useState<string>(
    () => readPersistedWorkspaceId() ?? '',
  );

  useEffect(() => {
    let cancelled = false;
    // MUST carry the app JWT: the server only runs the per-user grant filter
    // when it can resolve req.user from `Authorization: Bearer`. A tokenless
    // request falls into the route's "anonymous → all workspaces" branch, which
    // on real-auth stacks (:11000 / prod) leaks workspaces the user isn't
    // granted into the switcher (e.g. a prod-only user still sees `local`).
    const token = readAppToken();
    fetch('/api/workspaces', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((body: { workspaces: WorkspaceDef[] }) => {
        if (cancelled) return;
        const list = Array.isArray(body?.workspaces) ? body.workspaces : [];
        setWorkspaces(list);
        // If no persisted id (or the persisted id no longer exists), fall back
        // to the server-marked default.
        const haveCurrent = list.some((w) => w.id === workspaceId);
        if (!haveCurrent) {
          const fallback = list.find((w) => w.isDefault)?.id ?? list[0]?.id ?? '';
          if (fallback) {
            setWorkspaceIdState(fallback);
            persistWorkspaceId(fallback);
          }
        }
        setReady(true);
      })
      .catch(() => {
        // Server unreachable / registry endpoint missing — keep the persisted
        // selection so existing client-only surfaces still render.
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-pref hydration (or a switch in another tab) can update the persisted
  // workspace from another device. Reflect it in context — surfaces re-key off
  // workspaceId, and the synchronous readers already see the updated mirror.
  useEffect(() => {
    return subscribe(WORKSPACE_STORAGE_KEY, (next) => {
      if (next) setWorkspaceIdState((prev) => (prev === next ? prev : next));
    });
  }, []);

  const setWorkspaceId = useCallback((next: string) => {
    setWorkspaceIdState((prev) => {
      if (prev === next) return prev;
      persistWorkspaceId(next);
      if (typeof window !== 'undefined') {
        // Stale-artifact wipe — these keys carry data that belongs to the
        // previous workspace's Cube namespace and would 4xx / surface ghost
        // values on the new one. The server-side workspace partitioning
        // (segments / dashboards / cube_aliases / chat_sessions) handles
        // persistence; localStorage just caches client-only state.
        //   gds-cube:token         — minted JWT for the prior workspace's
        //                            Cube. Re-minted by useCubeTokenBootstrap
        //                            after the switch.
        //   gds-cube:cube-aliases  — pre-Phase-04 alias storage; now
        //                            authoritative on the server per workspace.
        // We leave the workspace and game keys alone — they are the source of
        // truth for what's selected next.
        try {
          window.localStorage.removeItem('gds-cube:token');
          window.localStorage.removeItem('gds-cube:cube-aliases');
        } catch {
          // ignore quota / privacy errors
        }
        window.dispatchEvent(
          new CustomEvent(WORKSPACE_CHANGE_EVENT, { detail: { workspaceId: next } }),
        );
        // Telemetry: the switch persisted, so the beacon is attributed to the
        // new workspace. Fire-and-forget — never blocks the switch.
        recordWorkspaceSwitch(next);
      }
      return next;
    });
  }, []);

  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({ workspaceId, workspaces, setWorkspaceId, ready, workspace }),
    [workspaceId, workspaces, setWorkspaceId, ready, workspace],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    // Allow consumers outside the provider tree (e.g. tests, isolated previews)
    // — they get a no-op shape instead of crashing.
    return {
      workspaceId: '',
      workspaces: [],
      setWorkspaceId: () => {},
      ready: false,
      workspace: null,
    };
  }
  return ctx;
}

/**
 * Read the active workspace id from localStorage without subscribing to React.
 * Used by non-React fetch wrappers (`api-client.ts`) to attach the header.
 */
export function getActiveWorkspaceId(): string | null {
  return readPersistedWorkspaceId();
}

export const WORKSPACE_HEADER = 'x-cube-workspace';
export { WORKSPACE_CHANGE_EVENT };

/**
 * Strip a known cube prefix from a cube name. Used to bridge prod cube-dev
 * (cubes named `<prefix>_<base>`) with downstream code (business-metrics
 * registry, anomaly configs, etc.) that references the unprefixed base.
 *
 * Returns null when no underscore is present (can't safely strip).
 *
 *   unprefixedAlias('ballistar_active_daily') → 'active_daily'
 *   unprefixedAlias('active_daily')           → null
 */
export function unprefixedAlias(name: string): string | null {
  const idx = name.indexOf('_');
  if (idx <= 0) return null;
  return name.slice(idx + 1);
}
