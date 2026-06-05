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

/** Inject an identity-IN filter so the query is scoped to an explicit uid set.
 *  Use only for small, bounded id sets (e.g. a paginated members page) — never
 *  the full materialized uid_list, which can be millions long and blow past
 *  Cube's query-text length limit. For full-cohort scoping use
 *  {@link scopeQueryToCohort}. */
export function scopeQueryToSegment(
  query: Query,
  identityDim: string,
  uids: string[],
): Query {
  if (uids.length === 0) return query;
  const idFilter = { member: identityDim, operator: 'equals' as never, values: uids };
  return {
    ...query,
    filters: [...(Array.isArray(query.filters) ? query.filters : []), idFilter],
  };
}

/** Parse the segment's predicate filters from its stored Cube query JSON.
 *  Returns [] when absent/unparseable (manual segments carry no predicate). */
export function predicateFiltersForSegment(segment: Segment): unknown[] {
  if (!segment.cube_query_json) return [];
  try {
    const q = JSON.parse(segment.cube_query_json) as { filters?: unknown[] };
    return Array.isArray(q.filters) ? q.filters : [];
  } catch {
    return [];
  }
}

/** Scope a card query to the segment's cohort.
 *  - `uidsOverride` given (paginated members page): identity-IN over that small,
 *    explicit id set — the only correct scope for "the visible rows".
 *  - Predicate segment: AND on the segment's predicate filters — the same basis
 *    as the segment's authoritative size. An all-users predicate (`filters: []`)
 *    leaves the query unscoped, which is correct. This avoids inlining the full
 *    uid_list (HTTP 400 `Query text length exceeds the maximum length`) and is
 *    the only correct approach for ratio measures (ARPU, paying-rate).
 *  - Manual segment (no predicate): identity-IN over the uid_list. Manual
 *    segments are explicit pushes, so the list is bounded. */
export function scopeQueryToCohort(
  query: Query,
  segment: Segment,
  identityDim: string,
  uidsOverride?: string[],
): Query {
  if (uidsOverride) {
    return scopeQueryToSegment(query, identityDim, uidsOverride);
  }
  if (segment.type === 'predicate') {
    const predicateFilters = predicateFiltersForSegment(segment);
    if (predicateFilters.length === 0) return query;
    const filters = Array.isArray(query.filters) ? [...query.filters] : [];
    return { ...query, filters: [...filters, ...predicateFilters] as Query['filters'] };
  }
  return scopeQueryToSegment(query, identityDim, segment.uid_list ?? []);
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

  // Prefix workspaces (prod cube-dev) namespace cubes per game
  // (`ballistar_mf_users`). Logical-named preset card queries must be
  // physicalized before /load and the physical-keyed response logicalized back.
  // Null on game_id/local → both translations are strict no-ops.
  const { workspace } = useWorkspaceContext();
  const activeGameId = useActiveGameId();

  // A segment carries its own game_id, and its cohort metrics MUST be queried
  // under that game's Cube security scope — the same per-game token the server
  // card-runner uses. Pin the x-cube-game header to the segment's game (the
  // proxy mints the matching JWT from it) so a segment viewed under a different
  // header game can't return that other game's — or a global — numbers. Fall
  // back to the active game only for segments with no game_id.
  const segmentGameId = segment?.game_id ?? null;
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null, segmentGameId);
  const prefix = resolveGamePrefix(workspace, segmentGameId ?? activeGameId ?? null);

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

    // Scope to the cohort by predicate (or identity-IN for manual / paginated
    // member pages), then physicalize logical preset members for prefix
    // workspaces. Both are no-ops where they don't apply (prefix null, etc).
    const scopedLogical = scopeQueryToCohort(query, segment, identityDim, options.uidsOverride);
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
  }, [segment?.id, segment?.cube_query_json, segment?.type, JSON.stringify(query), identityDim, cubejsApi, hasInitial, skipBackground, prefix, JSON.stringify(options.uidsOverride)]);

  return { loading, error, rows };
}

/** Reset cache — exposed for tests. */
export function __resetSegmentCubeQueryCache(): void {
  cache.clear();
  inFlight = 0;
  waiters.length = 0;
}
