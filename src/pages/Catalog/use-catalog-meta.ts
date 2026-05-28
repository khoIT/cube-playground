import { useEffect, useState } from 'react';
import { useAppContext } from '../../hooks';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useWorkspaceContext, WORKSPACE_HEADER } from '../../components/workspace-context';
import { CUBE_TO_CDP_MAPPING } from './cdp-projection/cube-to-cdp-mapping';

export type CatalogMeasure = {
  name: string;
  title?: string;
  description?: string;
  aggType?: string;
  format?: string;
  meta?: { source?: string; author?: string; tags?: unknown };
};

export type CatalogDimension = {
  name: string;
  title?: string;
  type?: string;
  primaryKey?: boolean;
  public?: boolean;
};

export type CatalogJoin = {
  name: string;
  relationship?: string;
  sql: string;
};

export type CatalogSegment = {
  name: string;
  title?: string;
  description?: string;
};

export type CatalogCube = {
  name: string;
  title?: string;
  description?: string;
  type?: 'cube' | 'view';
  isVisible?: boolean;
  public?: boolean;
  connectedComponent?: number;
  measures: CatalogMeasure[];
  dimensions: CatalogDimension[];
  segments?: CatalogSegment[];
  joins?: CatalogJoin[];
  preAggregations?: Array<{ name: string; type?: string; granularity?: string; timeDimension?: string }>;
  meta?: { game_id?: string; cdp_source?: string; [k: string]: unknown };
};

function mergeCdpMapping(cubes: CatalogCube[]): CatalogCube[] {
  return cubes.map((cube) => {
    const mapping = CUBE_TO_CDP_MAPPING[cube.name];
    if (!mapping && !cube.meta) return cube;
    return { ...cube, meta: { ...(cube.meta ?? {}), ...(mapping ?? {}) } };
  });
}

interface UseCatalogMetaResult {
  cubes: CatalogCube[];
  loading: boolean;
  error: string | null;
}

/**
 * Standalone /meta fetch for the Catalog page — fetches `?extended=true`
 * directly so `joins[]`, `connectedComponent`, and `preAggregations` are
 * available without depending on a mounted QueryBuilder.
 */
export function useCatalogMeta(): UseCatalogMetaResult {
  const ctx = useAppContext() as unknown as {
    apiUrl: string | null;
    token: string | null;
  };
  const gameId = useActiveGameId();
  const { workspaceId, workspace } = useWorkspaceContext();
  const [cubes, setCubes] = useState<CatalogCube[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx.apiUrl) {
      setLoading(false);
      setError('API not configured');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const base = ctx.apiUrl.endsWith('/v1') ? ctx.apiUrl : `${ctx.apiUrl}/v1`;
    // Prefix workspaces (e.g. prod cube-dev) namespace cubes by `<prefix>_<name>`
    // and do NOT accept a game_id query param. Local workspaces still send
    // game_id so Cube's repositoryFactory picks the right schema.
    const isPrefixWorkspace = workspace?.gameModel === 'prefix';
    const url = isPrefixWorkspace
      ? `${base}/meta?extended=true`
      : `${base}/meta?extended=true&game_id=${encodeURIComponent(gameId)}`;
    // 10s timeout — Cube can hang (TCP-up, HTTP-stuck) and `fetch` without an
    // AbortController would leave `loading=true` forever, surfacing as an
    // infinite "Loading…" spinner across Catalog routes.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    // No-auth workspaces (e.g. prod cube-dev open access) return a null token
    // from the mint endpoint — only set Authorization if we actually have one.
    // The Fastify cube-proxy injects/validates auth per workspace upstream.
    const headers: Record<string, string> = {};
    if (ctx.token) headers.Authorization = ctx.token;
    if (workspaceId) headers[WORKSPACE_HEADER] = workspaceId;
    fetch(url, { headers, signal: ctl.signal })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as { cubes: CatalogCube[] };
        if (!cancelled) {
          const all = json.cubes ?? [];
          // Prefix filtering — keep only cubes whose `name` starts with
          // `${prefix}_`. Use a strict `_` boundary so `cfm` doesn't also
          // match `cfmx`. Preserve `name` for queries; UI derives titles.
          const prefix = isPrefixWorkspace
            ? workspace?.gamePrefixMap?.[gameId]
            : undefined;
          const filtered = prefix
            ? all.filter((c) => c.name.startsWith(`${prefix}_`))
            : all;
          setCubes(mergeCdpMapping(filtered));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err instanceof DOMException && err.name === 'AbortError'
              ? 'Cube backend timed out (10s). Reload after it recovers.'
              : err instanceof Error
              ? err.message
              : String(err);
          setError(msg);
          setLoading(false);
        }
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      ctl.abort();
      clearTimeout(timer);
    };
    // ctx.token deliberately omitted: for no-auth workspaces (prod cube-dev)
    // the token resolves to '' and we don't want to re-fetch on every token tick.
  }, [ctx.apiUrl, gameId, workspaceId, workspace?.gameModel, workspace?.gamePrefixMap]);

  return { cubes, loading, error };
}
