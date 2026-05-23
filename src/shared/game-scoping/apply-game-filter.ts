/**
 * Game-scoping helper for Cube queries.
 *
 * Given a Cube `Query`, the active `gameId`, and a predicate that knows
 * which cubes expose a `gameId` dimension, return a new query with an
 * `equals` filter appended on every applicable cube. Idempotent — if a
 * filter already exists on `<cube>.gameId`, the query is returned unchanged
 * for that cube.
 *
 * Why client-side: today the Cube backend is not game-namespaced. This util
 * lets the UI behave as if it were, while we keep the door open for server-
 * side scoping later (the function becomes a no-op when the backend filters
 * server-side).
 */

import type { Query } from '@cubejs-client/core';

const GAME_DIM_SUFFIX = '.gameId';

function cubeNameOf(member: string): string {
  const dot = member.indexOf('.');
  return dot >= 0 ? member.slice(0, dot) : member;
}

function collectReferencedCubes(query: Query): Set<string> {
  const cubes = new Set<string>();
  const acc = (m: string) => cubes.add(cubeNameOf(m));
  query.measures?.forEach(acc);
  query.dimensions?.forEach(acc);
  query.timeDimensions?.forEach((td) => acc(td.dimension));
  query.segments?.forEach(acc);
  return cubes;
}

function hasGameFilterOnCube(query: Query, cube: string): boolean {
  const target = `${cube}${GAME_DIM_SUFFIX}`;
  return (query.filters ?? []).some((f: any) => f?.member === target);
}

export function applyGameFilter(
  query: Query | null | undefined,
  gameId: string,
  cubeHasGameDim: (cube: string) => boolean,
): Query | null {
  if (!query) return query ?? null;
  if (!gameId) return query;

  const cubes = collectReferencedCubes(query);
  const additions: Array<{ member: string; operator: 'equals'; values: [string] }> = [];
  cubes.forEach((cube) => {
    if (!cubeHasGameDim(cube)) return;
    if (hasGameFilterOnCube(query, cube)) return;
    additions.push({
      member: `${cube}${GAME_DIM_SUFFIX}`,
      operator: 'equals',
      values: [gameId],
    });
  });

  if (additions.length === 0) return query;
  return {
    ...query,
    filters: [...(query.filters ?? []), ...additions] as Query['filters'],
  };
}
