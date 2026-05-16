import { useEffect, useState } from 'react';
import { useAppContext } from '../../hooks';

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
  joins?: CatalogJoin[];
  preAggregations?: Array<{ name: string; type?: string; granularity?: string; timeDimension?: string }>;
};

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
    fetch(`${base}/meta?extended=true`, {
      headers: { Authorization: ctx.token },
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as { cubes: CatalogCube[] };
        if (!cancelled) {
          setCubes(json.cubes ?? []);
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
  }, [ctx.apiUrl, ctx.token]);

  return { cubes, loading, error };
}
