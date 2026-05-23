import { useEffect, useState } from 'react';
import { useAppContext } from '../../hooks';
import { useActiveGameId } from '../../components/Header/use-game-context';
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
  const [cubes, setCubes] = useState<CatalogCube[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx.apiUrl || !ctx.token) {
      setLoading(false);
      setError('API not configured');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const base = ctx.apiUrl.endsWith('/v1') ? ctx.apiUrl : `${ctx.apiUrl}/v1`;
    // Server-side schema isn't game-namespaced today; this param is a hint for
    // a future Cube proxy that filters by `cube.meta.game_id`. Client-side
    // fallback below applies the filter against cube.meta.game_id.
    const url = `${base}/meta?extended=true&game_id=${encodeURIComponent(gameId)}`;
    fetch(url, {
      headers: { Authorization: ctx.token },
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as { cubes: CatalogCube[] };
        if (!cancelled) {
          setCubes(mergeCdpMapping(json.cubes ?? []));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ctx.apiUrl, ctx.token, gameId]);

  return { cubes, loading, error };
}
