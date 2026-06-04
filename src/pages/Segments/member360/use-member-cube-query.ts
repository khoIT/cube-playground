/**
 * Single-member live Cube query hook for the per-member 360 page.
 *
 * Unlike `useSegmentCubeQuery` (which ANDs the segment's slice filters + an
 * identity-IN over the whole uid_list — correct for cohort monitoring, wrong
 * for one member's full history), this hook sends the caller's query verbatim,
 * only translating logical → physical member names for prefix workspaces and
 * the physical-keyed response back to logical. The caller is responsible for
 * the per-member identity filter (`user_id = X`, `playerid IN role_ids`, …) and
 * any date bound the behavior guardrail requires.
 *
 * Concurrency is capped at 3 in-flight loads (module-local semaphore, mirrors
 * the segment hook) so opening a 360 with ~9 eager panels doesn't fan out an
 * unbounded burst of Trino round-trips.
 */

import { useEffect, useRef, useState } from 'react';
import type { Query } from '@cubejs-client/core';
import { useSecurityContext } from '../../../hooks/security-context';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import { useAppContext } from '../../../hooks';
import { useWorkspaceContext } from '../../../components/workspace-context';
import { resolveGamePrefix, physicalizeQuery, logicalizeRows } from '../../../lib/cube-member-resolver';

const MAX_CONCURRENT = 3;
let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function release(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

export interface UseMemberCubeQueryResult<T = Record<string, unknown>> {
  loading: boolean;
  error: Error | null;
  rows: T[];
}

/**
 * Load `query` for one member from live Cube. `gameId` drives the prefix
 * resolution (null/local → no-op). Pass `query === null` to stay idle (e.g. a
 * lazy panel that hasn't been expanded yet).
 */
export function useMemberCubeQuery<T = Record<string, unknown>>(
  gameId: string | null,
  query: Query | null,
): UseMemberCubeQueryResult<T> {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  // Pin the cube schema to the segment's game, not the global game selector —
  // the proxy mints the per-game JWT from this header.
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null, gameId);
  const { workspace } = useWorkspaceContext();
  const prefix = resolveGamePrefix(workspace, gameId);

  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!query) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!cubejsApi) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    const scoped = physicalizeQuery(query, prefix);
    const reqId = ++reqIdRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      await acquire();
      try {
        if (cancelled) return;
        const resultSet = await cubejsApi.load(scoped as never);
        const rawPhysical = (resultSet as unknown as { rawData: () => unknown[] }).rawData();
        const raw = logicalizeRows(rawPhysical, prefix) as T[];
        // Ignore stale responses (a newer query superseded this one).
        if (!cancelled && reqId === reqIdRef.current) {
          setRows(raw);
        }
      } catch (err) {
        if (!cancelled && reqId === reqIdRef.current) setError(err as Error);
      } finally {
        release();
        if (!cancelled && reqId === reqIdRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId, prefix, cubejsApi, JSON.stringify(query)]);

  return { loading, error, rows };
}

/** Reset the in-flight semaphore — exposed for tests. */
export function __resetMemberCubeQueryThrottle(): void {
  inFlight = 0;
  waiters.length = 0;
}
