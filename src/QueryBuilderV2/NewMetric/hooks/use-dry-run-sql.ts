import { useRef, useState, useCallback, useMemo } from 'react';
import { useQueryBuilderContext } from '../../context';
import { NewMetricDraft } from '../types';
import { useReachableMembers } from './use-reachable-members';

type DryRunArgs = {
  draft: NewMetricDraft;
  sourceCube: string | null;
  measureName: string;
  fragment: string;
};

type DryRunResult = {
  sql: string | null;
  error: string | null;
};

type CachedEntry = {
  hash: string;
  result: DryRunResult;
};

type UseDryRunSqlReturn = {
  /** True when the draft has changed since the last successful run. */
  isStale: boolean;
  isRunning: boolean;
  result: DryRunResult | null;
  run: () => Promise<void>;
};

/** Build a stable hash string from the fields that affect the SQL output. */
function buildHash(args: DryRunArgs): string {
  return JSON.stringify({
    ofMember: args.draft.ofMember,
    ofMemberB: args.draft.ofMemberB,
    operation: args.draft.operation,
    filter: args.draft.filter,
    sourceCube: args.sourceCube,
    measureName: args.measureName,
    fragment: args.fragment,
  });
}

/**
 * Dry-run SQL hook.
 *
 * POC validation strategy: because the new measure does not yet exist in the
 * Cube schema, we cannot query it directly. Instead we validate that the
 * *source members* the new measure derives from are queryable by Cube. This
 * gives a useful "source is reachable / compile error" signal before saving.
 *
 * Caches the last result keyed by a stable hash; `isStale` is true whenever
 * the current hash differs from the cached one.
 */
export function useDryRunSql(args: DryRunArgs): UseDryRunSqlReturn {
  const { apiUrl, apiToken } = useQueryBuilderContext();
  const { items } = useReachableMembers(args.sourceCube);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const cacheRef = useRef<CachedEntry | null>(null);

  // Build qualified-name → kind map so we route dimensions to dimensions[] and
  // measures to measures[] in the synthetic query.
  const kindByName = useMemo(() => {
    const map = new Map<string, 'dimension' | 'measure'>();
    for (const item of items) map.set(item.memberName, item.kind);
    return map;
  }, [items]);

  const currentHash = buildHash(args);
  const isStale = cacheRef.current === null || cacheRef.current.hash !== currentHash;

  const run = useCallback(async () => {
    if (!args.sourceCube || !apiUrl) {
      setResult({ sql: null, error: 'No source cube or API URL configured.' });
      return;
    }

    // If cached result is still valid, reuse it without a network call.
    if (!isStale && cacheRef.current) {
      setResult(cacheRef.current.result);
      return;
    }

    setIsRunning(true);

    try {
      // Build a synthetic query against the *source members* the new measure
      // derives from. Route each pick to measures[] or dimensions[] based on its
      // kind in meta — Cube rejects a dimension placed in measures[] and vice versa.
      const queryMeasures: string[] = [];
      const queryDimensions: string[] = [];

      const routeMember = (qualified: string) => {
        const kind = kindByName.get(qualified);
        if (kind === 'dimension') queryDimensions.push(qualified);
        else queryMeasures.push(qualified);  // measure (default if unknown)
      };

      if (args.draft.ofMember) routeMember(args.draft.ofMember);
      if (args.draft.operation === 'ratio' && args.draft.ofMemberB) {
        routeMember(args.draft.ofMemberB);
      }

      const syntheticQuery = {
        measures: queryMeasures.length > 0 ? queryMeasures : undefined,
        dimensions: queryDimensions.length > 0 ? queryDimensions : undefined,
        limit: 1,
      };

      // Strip trailing /v1 if present — /sql lives at v1 path
      const baseUrl = apiUrl.endsWith('/v1') ? apiUrl : `${apiUrl}/v1`;
      const endpoint = `${baseUrl}/sql`;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        },
        body: JSON.stringify({ query: syntheticQuery }),
      });

      let dryResult: DryRunResult;

      if (resp.ok) {
        const json = await resp.json() as { sql?: { sql?: [string, unknown[]] } };
        // Cube /sql returns { sql: { sql: ["SELECT ...", [...params]] } }
        const sqlTuple = json?.sql?.sql;
        const sqlString = Array.isArray(sqlTuple) ? (sqlTuple[0] as string) : null;
        dryResult = { sql: sqlString, error: null };
      } else {
        let errorMsg = `HTTP ${resp.status}`;
        try {
          const errJson = await resp.json() as { error?: string; message?: string };
          errorMsg = errJson.error ?? errJson.message ?? errorMsg;
        } catch {
          // JSON parse failed; keep HTTP status message
        }
        dryResult = { sql: null, error: errorMsg };
      }

      cacheRef.current = { hash: currentHash, result: dryResult };
      setResult(dryResult);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const dryResult: DryRunResult = { sql: null, error: errorMsg };
      // Don't cache network errors — allow retry
      setResult(dryResult);
    } finally {
      setIsRunning(false);
    }
  }, [args, apiUrl, apiToken, currentHash, isStale, kindByName]);

  return { isStale, isRunning, result, run };
}
