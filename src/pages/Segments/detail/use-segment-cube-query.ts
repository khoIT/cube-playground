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
import { useWorkspaceContext } from '../../../components/workspace-context';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import { resolveGamePrefix, physicalizeQuery, logicalizeRows } from '../../../lib/cube-member-resolver';
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

/**
 * Scope a card query to the segment by ANDing on:
 *   1. `sliceFilters` — the segment's predicate (e.g. os_platform=iOS, a date
 *      window). These give measures the right window so the monitor matches the
 *      query-builder cell the segment came from, instead of re-aggregating each
 *      user's entire history.
 *   2. an identity-IN filter pinning the result to the materialized uid list.
 */
export function scopeQueryToSegment(
  query: Query,
  identityDim: string,
  uids: string[],
  sliceFilters: Query['filters'] = [],
): Query {
  const extra = Array.isArray(sliceFilters) ? [...sliceFilters] : [];
  if (uids.length > 0) {
    extra.push({ member: identityDim, operator: 'equals' as never, values: uids });
  }
  if (extra.length === 0) return query;
  const next: Query = { ...query };
  next.filters = [...(Array.isArray(query.filters) ? query.filters : []), ...extra];
  return next;
}

/** Parse the segment's predicate-derived Cube filters from cube_query_json. */
export function segmentSliceFilters(segment: Segment | null): Query['filters'] {
  if (!segment?.cube_query_json) return [];
  try {
    const parsed = JSON.parse(segment.cube_query_json) as { filters?: Query['filters'] };
    return Array.isArray(parsed.filters) ? parsed.filters : [];
  } catch {
    return [];
  }
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

  // Prefix workspaces (prod cube-dev) namespace cubes per game
  // (`ballistar_mf_users`). Logical-named preset card queries must be
  // physicalized before /load and the physical-keyed response logicalized back.
  // Null on game_id/local → both translations are strict no-ops.
  const { workspace } = useWorkspaceContext();
  const activeGameId = useActiveGameId();
  const prefix = resolveGamePrefix(workspace, activeGameId || null);

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
    const scopedLogical = scopeQueryToSegment(query, identityDim, uidsForScope, segmentSliceFilters(segment));
    // Idempotent: already-physical slice filters pass through untouched; only
    // the logical preset members get prefixed. No-op when prefix is null.
    const scoped = physicalizeQuery(scopedLogical, prefix);
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
        const rawPhysical = (resultSet as unknown as { rawData: () => unknown[] }).rawData();
        // Strip the prefix from row keys so logical-named card specs read them
        // (no-op on game_id/local).
        const raw = logicalizeRows(rawPhysical, prefix);
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
  }, [segment?.id, JSON.stringify(query), identityDim, cubejsApi, hasInitial, skipBackground, prefix, JSON.stringify(options.uidsOverride)]);

  return { loading, error, rows };
}

/** Reset cache — exposed for tests. */
export function __resetSegmentCubeQueryCache(): void {
  cache.clear();
  inFlight = 0;
  waiters.length = 0;
}
