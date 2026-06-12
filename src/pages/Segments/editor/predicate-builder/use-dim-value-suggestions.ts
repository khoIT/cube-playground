/**
 * Lazy one-shot distinct-value suggestions for a string dimension.
 *
 * Fired on focus, cached per (workspace, game, dim) so tabbing away and back
 * does not re-query. Only activates for string-typed members with equality-
 * family operators (equals / in / notIn) — never for number or time dims.
 *
 * Query shape: { dimensions: [dim], limit: 50 }
 * Result: the distinct string values Cube returns, de-duped and sorted.
 */

import { useState, useCallback } from 'react';
import { useAppContext } from '../../../../hooks';
import { useSecurityContext } from '../../../../hooks/security-context';
import { useWorkspaceContext } from '../../../../components/workspace-context';
import { useCubejsApi } from '../../../../hooks/cubejs-api';
import { useActiveGameId } from '../../../../components/Header/use-game-context';
import type { LeafOperator, LeafValueType } from '../../../../types/segment-api';

/** Operators for which value suggestions are useful. */
const SUGGESTION_OPS = new Set<LeafOperator>(['equals', 'notEquals', 'in', 'notIn']);

/** Module-level cache: key = `${workspaceId}::${gameId}::${dim}` → values. */
const suggestionsCache = new Map<string, string[]>();
const suggestionsInFlight = new Map<string, Promise<string[]>>();

interface LoadResult {
  values: string[];
}

interface CubeQueryResult {
  rawData(): Array<Record<string, unknown>>;
}

async function loadSuggestions(
  cubejsApi: { load(q: unknown): Promise<CubeQueryResult> },
  dim: string,
  cacheKey: string,
): Promise<string[]> {
  if (suggestionsCache.has(cacheKey)) return suggestionsCache.get(cacheKey)!;
  const inflight = suggestionsInFlight.get(cacheKey);
  if (inflight) return inflight;

  const promise: Promise<string[]> = (async () => {
    try {
      const result = await cubejsApi.load({ dimensions: [dim], limit: 50 });
      const rows = result.rawData();
      const values = [...new Set(
        rows
          .map((r) => r[dim])
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      )].sort();
      suggestionsCache.set(cacheKey, values);
      return values;
    } catch {
      // Query failed (missing rollup, bad dim name, etc.) — return empty so
      // the AutoComplete just shows free-text entry with no suggestions.
      return [];
    } finally {
      suggestionsInFlight.delete(cacheKey);
    }
  })();

  suggestionsInFlight.set(cacheKey, promise);
  return promise;
}

export interface UseDimValueSuggestionsResult {
  /** Call this on the value-input's onFocus event to trigger/retrieve suggestions. */
  fetchSuggestions: () => void;
  suggestions: string[];
  loading: boolean;
}

/**
 * Returns a `fetchSuggestions` trigger and the cached result for `dim`.
 * Pass `null` for dim or non-string/non-equality context — the hook is a no-op.
 */
export function useDimValueSuggestions(
  dim: string | null,
  type: LeafValueType,
  op: LeafOperator,
): UseDimValueSuggestionsResult {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const { workspaceId } = useWorkspaceContext();
  const gameId = useActiveGameId();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const isEligible = type === 'string' && SUGGESTION_OPS.has(op) && dim != null && dim.includes('.');

  const fetchSuggestions = useCallback(() => {
    if (!isEligible || !dim || !cubejsApi) return;

    const cacheKey = `${workspaceId ?? ''}::${gameId ?? ''}::${dim}`;

    // Synchronous cache hit — set immediately without async cycle.
    if (suggestionsCache.has(cacheKey)) {
      setSuggestions(suggestionsCache.get(cacheKey)!);
      return;
    }

    setLoading(true);
    loadSuggestions(
      cubejsApi as unknown as { load(q: unknown): Promise<CubeQueryResult> },
      dim,
      cacheKey,
    ).then((values: string[]) => {
      setSuggestions(values);
      setLoading(false);
    });
  }, [isEligible, dim, cubejsApi, workspaceId, gameId]);

  return { fetchSuggestions, suggestions: isEligible ? suggestions : [], loading };
}

/** Exported for unit tests: reset both caches between test runs. */
export function _resetSuggestionsCache(): void {
  suggestionsCache.clear();
  suggestionsInFlight.clear();
}

/** Exported for unit tests: prime the cache with a known result. */
export function _primeSuggestionsCache(key: string, values: string[]): LoadResult {
  suggestionsCache.set(key, values);
  return { values };
}
