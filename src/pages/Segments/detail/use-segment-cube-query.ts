/**
 * Cached, throttled, segment-scoped Cube query hook.
 *
 * Each card calls useSegmentCubeQuery(segment, query). The query is augmented
 * with `filters: [{ member: identityDim, operator: 'in', values: uids }]` and
 * sent through the existing cubejsApi instance. Results are cached for 10 min
 * keyed by (segment.id, query-hash). Concurrent fetches are capped at 3.
 *
 * If cubejsApi is unavailable (no token), the hook returns a stable empty
 * state without firing the request — cards render their loading/empty UI.
 */

import { useEffect, useRef, useState } from 'react';
import type { Query } from '@cubejs-client/core';
import { useSecurityContext } from '../../../hooks/security-context';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import { useAppContext } from '../../../hooks';
import type { Segment } from '../../../types/segment-api';

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT = 3;

interface CacheEntry {
  result: unknown[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquire() {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function release() {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

function hashKey(segmentId: string, query: unknown): string {
  return `${segmentId}::${JSON.stringify(query)}`;
}

export interface UseSegmentCubeQueryResult<T = Record<string, unknown>> {
  loading: boolean;
  error: Error | null;
  rows: T[];
}

/** Inject an identity-IN filter so the query is scoped to the segment's uids. */
export function scopeQueryToSegment(
  query: Query,
  identityDim: string,
  uids: string[],
): Query {
  if (uids.length === 0) return query;
  const next: Query = { ...query };
  const filters = Array.isArray(query.filters) ? [...query.filters] : [];
  filters.push({ member: identityDim, operator: 'equals' as never, values: uids });
  next.filters = filters;
  return next;
}

export interface UseSegmentCubeQueryOptions<T> {
  /** Pre-rendered rows from server cache. Skips initial loading flicker and lets
   *  the hook silently background-refetch (updating display only if rows differ). */
  initialRows?: T[];
  /** When true AND initialRows is provided, skip the background Cube fetch
   *  entirely. Use when the server cache is known fresh — saves ~30 parallel
   *  Cube round-trips per tab open. */
  skipBackgroundFetch?: boolean;
  /** Override the uid list used for the identity-IN scoping filter. Useful when
   *  scoping to a paginated subset of segment members (e.g. visible page only)
   *  instead of the segment's full uid_list. */
  uidsOverride?: string[];
}

export function useSegmentCubeQuery<T = Record<string, unknown>>(
  segment: Segment | null,
  query: Query | null,
  identityDim: string,
  options: UseSegmentCubeQueryOptions<T> = {},
): UseSegmentCubeQueryResult<T> {
  const { apiUrl } = useAppContext();
  // `token` is the localStorage-only manual override (Security Context modal);
  // `currentToken` falls back to AppContext's token, which is populated by
  // useCubeApiBootstrap from /playground/context. Use currentToken so cards
  // work without requiring the user to open the modal first.
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);

  const hasInitial = options.initialRows !== undefined;
  const skipBackground = hasInitial && options.skipBackgroundFetch === true;
  const [rows, setRows] = useState<T[]>(options.initialRows ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!segment || !query) return;

    // Fresh server cache → trust it. No Cube round-trip.
    if (skipBackground) {
      setLoading(false);
      setError(null);
      return;
    }

    const uidsForScope = options.uidsOverride ?? segment.uid_list ?? [];
    const scoped = scopeQueryToSegment(query, identityDim, uidsForScope);
    const key = hashKey(segment.id, scoped);

    const cached = cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setRows(cached.result as T[]);
      setLoading(false);
      setError(null);
      lastKeyRef.current = key;
      return;
    }

    if (!cubejsApi) {
      // No API client. If we have pre-rendered rows, keep them; otherwise empty.
      if (!hasInitial) setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    // Only show the spinner if we have nothing to display yet.
    setLoading(!hasInitial);
    setError(null);

    (async () => {
      await acquire();
      try {
        const resultSet = await cubejsApi.load(scoped as never);
        const raw = (resultSet as unknown as { rawData: () => unknown[] }).rawData();
        if (!cancelled) {
          cache.set(key, { result: raw, fetchedAt: Date.now() });
          // Diff against current display state; skip setState when identical
          // so background refetches don't trigger unnecessary re-renders.
          setRows((prev) =>
            JSON.stringify(prev) === JSON.stringify(raw) ? prev : (raw as T[]),
          );
          lastKeyRef.current = key;
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        release();
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [segment?.id, JSON.stringify(query), identityDim, cubejsApi, hasInitial, skipBackground, JSON.stringify(options.uidsOverride)]);

  return { loading, error, rows };
}

/** Reset cache — exposed for tests. */
export function __resetSegmentCubeQueryCache(): void {
  cache.clear();
  inFlight = 0;
  waiters.length = 0;
}
