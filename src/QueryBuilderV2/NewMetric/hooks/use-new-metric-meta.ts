import { useCallback, useEffect, useMemo, useState } from 'react';
import cubejs, { CubeApi, HttpTransport } from '@cubejs-client/core';
import { useAppContext } from '../../../hooks';

/**
 * Wide cube-meta shape we read from the extended /meta endpoint.
 * Mirrors `CatalogCube` (src/pages/Catalog/use-catalog-meta.ts) plus the
 * extra fields the new-metric wizard cares about (column-type info).
 */
export type WizardColumn = {
  name: string;
  title?: string;
  type?: string;
  primaryKey?: boolean;
  public?: boolean;
  description?: string;
};
export type WizardMeasure = {
  name: string;
  title?: string;
  description?: string;
  aggType?: string;
  format?: string;
  meta?: { source?: string; author?: string; tags?: unknown };
};
export type WizardCube = {
  name: string;
  title?: string;
  description?: string;
  type?: 'cube' | 'view';
  isVisible?: boolean;
  public?: boolean;
  measures: WizardMeasure[];
  dimensions: WizardColumn[];
  joins?: Array<{ name: string; relationship?: string; sql: string }>;
  preAggregations?: Array<{ name: string; type?: string; granularity?: string; timeDimension?: string }>;
  connectedComponent?: number;
};

export type WizardMeta = {
  cubes: WizardCube[];
};

export type UseNewMetricMetaResult = {
  meta: WizardMeta | null;
  cubejsApi: CubeApi | null;
  loading: boolean;
  error: string | null;
  refreshMeta: () => void;
};

/**
 * Standalone meta bootstrap for the full-page New Metric wizard.
 *
 * `useAppContext()` does NOT carry `meta` or a CubeApi instance — those live
 * inside the QueryBuilder context, which the wizard does not mount. This hook
 * fetches `/meta?extended=true` directly (mirrors `use-catalog-meta.ts`) and
 * builds its own CubeApi instance from apiUrl + token.
 */
export function useNewMetricMeta(): UseNewMetricMetaResult {
  const ctx = useAppContext() as unknown as {
    apiUrl: string | null;
    token: string | null;
  };
  const [meta, setMeta] = useState<WizardMeta | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);

  const cubejsApi = useMemo<CubeApi | null>(() => {
    if (!ctx.apiUrl || !ctx.token || ctx.token === 'undefined') return null;
    // The wizard's SDK call must also carry x-cube-workspace so /load + /sql
    // route to the right backend (same fix as useCubejsApi).
    let wsId: string | null = null;
    try {
      wsId = typeof window !== 'undefined' ? window.localStorage.getItem('gds-cube:workspace') : null;
    } catch {
      /* ignore */
    }
    const headers: Record<string, string> = {};
    if (wsId) headers['x-cube-workspace'] = wsId;
    return cubejs(ctx.token, {
      apiUrl: ctx.apiUrl,
      transport: new HttpTransport({
        apiUrl: ctx.apiUrl,
        authorization: ctx.token,
        headers,
      }),
    } as Parameters<typeof cubejs>[1]);
  }, [ctx.apiUrl, ctx.token]);

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
    const fetchHeaders: Record<string, string> = { Authorization: ctx.token };
    try {
      const wsId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('gds-cube:workspace')
          : null;
      if (wsId) fetchHeaders['x-cube-workspace'] = wsId;
      // Scope the model fetch to the active game — otherwise the proxy mints a
      // game-less JWT and Cube's dev-mode fallback returns the default game's
      // schema (ballistar) instead of the selected game's cubes.
      const gameId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('gds-cube:active-game')
          : null;
      if (gameId) fetchHeaders['x-cube-game'] = gameId;
    } catch {
      /* ignore */
    }
    fetch(`${base}/meta?extended=true`, { headers: fetchHeaders })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as WizardMeta;
        if (cancelled) return;
        setMeta({ cubes: json.cubes ?? [] });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.apiUrl, ctx.token, bump]);

  const refreshMeta = useCallback(() => setBump((n) => n + 1), []);

  return { meta, cubejsApi, loading, error, refreshMeta };
}
