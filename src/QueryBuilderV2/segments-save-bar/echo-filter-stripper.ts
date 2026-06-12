/**
 * Deterministic removal of deeplink-injected "echo" filters.
 *
 * When the playground opens a segment definition via buildDefinitionDeeplink,
 * it may inject filters that are NOT part of the user's predicate:
 *
 *   - A game-scoping filter  { member: '<cube>.gameId', operator: 'equals',
 *                              values: [gameId] }  added by applyGameFilter.
 *
 * These are recorded verbatim in SegmentEditContext.echoFilters so they can
 * be removed by EXACT structural match before the modified query is converted
 * back to a predicate tree.  "Exact" means:
 *   - Same `member` string.
 *   - Same `operator` string.
 *   - Same `values` array contents (order-insensitive, string-coerced).
 *
 * A deliberate user-added filter that happens to share the same member (e.g.
 * the user explicitly adds a different gameId value) SURVIVES because the
 * values array differs.
 *
 * The identity dimension lives in query.dimensions[], not filters[], so it
 * is never present in filters and requires no stripping here.
 *
 * Logical (and/or) wrapper nodes are NOT stripped — only top-level leaf
 * filters are candidates. This matches how applyGameFilter injects filters
 * (it pushes a plain leaf onto the top-level filters array).
 */

import type { Query } from '@cubejs-client/core';
import type { SegmentEditContext } from '../../utils/playground-deeplink';

interface CubeLeafFilter {
  member?: string;
  dimension?: string;
  operator: string;
  values?: unknown[];
}

function valuesMatch(
  filterVals: unknown[] | undefined,
  echoVals: string[] | undefined,
): boolean {
  if (!echoVals || echoVals.length === 0) return !filterVals || filterVals.length === 0;
  if (!filterVals) return false;
  if (filterVals.length !== echoVals.length) return false;
  // Order-insensitive string comparison.
  const a = [...filterVals].map(String).sort();
  const b = [...echoVals].sort();
  return a.every((v, i) => v === b[i]);
}

function isEchoFilter(
  f: CubeLeafFilter,
  echoFilters: SegmentEditContext['echoFilters'],
): boolean {
  const member = f.member ?? f.dimension ?? '';
  return echoFilters.some(
    (echo) =>
      echo.member === member &&
      echo.operator === f.operator &&
      valuesMatch(f.values, echo.values),
  );
}

/**
 * Return a new query with all top-level echo filters removed.
 * The original query is not mutated.
 */
export function stripEchoFilters(
  query: Query,
  echoFilters: SegmentEditContext['echoFilters'],
): Query {
  if (!echoFilters.length || !query.filters?.length) return query;

  const stripped = (query.filters as unknown[]).filter((f) => {
    // Only attempt echo-match on plain leaf filters; logical groups are kept.
    if (typeof f !== 'object' || f === null) return true;
    const leaf = f as CubeLeafFilter;
    if ('and' in leaf || 'or' in leaf) return true;
    return !isEchoFilter(leaf, echoFilters);
  });

  return { ...query, filters: stripped as Query['filters'] };
}
