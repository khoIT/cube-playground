/**
 * Data hooks for the CubeStore storage section of the Pre-agg Runs tab.
 *
 *   useCubestoreStorage(active) — GET /api/preagg-runs/cubestore/tables
 *   useQueryCacheCheck()        — POST /api/preagg-runs/cubestore/query-cache
 *
 * Both go through apiFetch (admin JWT). The backend returns `enabled:false`
 * (not an error) where CubeStore introspection is off, so the UI renders a calm
 * note rather than an error card.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

// ---------------------------------------------------------------------------
// Wire types (mirror server/src/services/cubestore-*.ts)
// ---------------------------------------------------------------------------

export interface PreaggMaterialization {
  schema: string;
  base: string;
  tableCount: number;
  sealedCount: number;
  readyCount: number;
  partitions: number;
  activePartitions: number;
  rows: number;
  bytes: number;
  buildRangeEnd: string | null;
  sealAt: string | null;
}

export interface CubestoreStorage {
  enabled: boolean;
  generatedAt: string;
  schemas: Array<{ schema: string; preaggs: PreaggMaterialization[] }>;
  error: string | null;
}

export type CacheVerdict = 'materialized' | 'registered-not-active' | 'not-built';

export interface QueryCachePreagg {
  preAggregationId: string;
  tableName: string;
  verdict: CacheVerdict;
  activePartitions: number;
  rows: number;
  bytes: number;
  buildRangeEnd: string | null;
}

export interface QueryCacheCheck {
  enabled: boolean;
  willServeFromCache: boolean;
  preaggs: QueryCachePreagg[];
  note: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Fetch CubeStore materialised pre-aggs; only when `active` (section open). */
export function useCubestoreStorage(active: boolean) {
  const [data, setData] = useState<CubestoreStorage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    apiFetch<CubestoreStorage>('/api/preagg-runs/cubestore/tables')
      .then((d) => { setData(d); setError(null); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (active) refetch(); }, [active, refetch]);

  return { data, loading, error, refetch };
}

/** Imperative query-cache check — `run(game, query)` resolves a verdict. */
export function useQueryCacheCheck() {
  const [result, setResult] = useState<QueryCacheCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((game: string, query: unknown) => {
    setLoading(true);
    setError(null);
    return apiFetch<QueryCacheCheck>('/api/preagg-runs/cubestore/query-cache', {
      method: 'POST',
      body: { game, query },
    })
      .then((d) => setResult(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { result, loading, error, run };
}
