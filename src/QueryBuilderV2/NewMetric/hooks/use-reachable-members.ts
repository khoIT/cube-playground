import { useMemo } from 'react';
import { Cube } from '@cubejs-client/core';
import { useQueryBuilderContext } from '../../context';

// Cube type from the library omits joins — they are present in the raw API
// response and spread into the cube objects at runtime, so we cast locally.
type CubeJoin = { name: string; sql: string };
type CubeWithJoins = Cube & { joins?: CubeJoin[] };

export type ReachableMember = {
  cubeName: string;
  memberName: string;   // qualified, e.g. "users.email"
  shortName: string;    // unqualified, e.g. "email"
  kind: 'dimension' | 'measure';
  viaJoin?: { fromCube: string; sql: string };
};

export type JoinGraph = {
  /** undirected adjacency: cube name → set of neighbour cube names */
  adjacency: Map<string, Set<string>>;
  /** stable pair key "min|max" → join SQL verbatim from meta */
  joinSqlByPair: Map<string, string>;
};

/**
 * Build an undirected join graph from the raw cubes array.
 * Uses only cube.joins[] (not views). Dedupes by sorted pair key.
 * Self-loops are ignored.
 */
export function buildJoinGraph(cubes: Cube[]): JoinGraph {
  const adjacency = new Map<string, Set<string>>();
  const joinSqlByPair = new Map<string, string>();

  // Initialise every cube so isolated cubes appear with an empty neighbour set
  for (const cube of cubes) {
    if (!adjacency.has(cube.name)) {
      adjacency.set(cube.name, new Set());
    }
  }

  for (const cube of cubes as CubeWithJoins[]) {
    if (!cube.joins?.length) continue;

    for (const join of cube.joins) {
      const from = cube.name;
      const to = join.name;

      // Skip self-loops
      if (from === to) continue;

      // Stable pair key (direction-independent)
      const pairKey = [from, to].sort().join('|');

      if (!joinSqlByPair.has(pairKey)) {
        joinSqlByPair.set(pairKey, join.sql);
      }

      // Undirected: add both directions
      if (!adjacency.has(from)) adjacency.set(from, new Set());
      if (!adjacency.has(to)) adjacency.set(to, new Set());
      adjacency.get(from)!.add(to);
      adjacency.get(to)!.add(from);
    }
  }

  return { adjacency, joinSqlByPair };
}

/**
 * Get the pair key for two cube names (order-independent).
 */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * Derive all members reachable from one or more source cubes (one hop).
 * Source-cube members have `viaJoin === undefined`. Joined-cube members carry
 * `viaJoin.sql` verbatim from meta and `viaJoin.fromCube` set to the source
 * cube that owns the join. When multiple sources are passed, the union of
 * their reachable members is returned, de-duped by `memberName`.
 *
 * Accepts either a single cube name or an array. Single-cube callers stay
 * unchanged; multi-source callers (Phase 4) pass the array.
 *
 * Memoised on (cubes reference, sources tuple).
 */
export function useReachableMembers(sources: string | string[] | null): {
  items: ReachableMember[];
  reachableNames: Set<string>;
  joinedCubeCount: number;
} {
  const { cubes } = useQueryBuilderContext();

  const sourceList = useMemo(() => {
    if (sources == null) return [] as string[];
    return Array.isArray(sources) ? sources : [sources];
  }, [sources]);

  return useMemo(() => {
    const empty = { items: [], reachableNames: new Set<string>(), joinedCubeCount: 0 };
    if (sourceList.length === 0) return empty;

    const graph = buildJoinGraph(cubes);
    const cubeMap = new Map<string, CubeWithJoins>(
      (cubes as CubeWithJoins[]).map((c) => [c.name, c])
    );

    // Track per-cube reachability with the source that reached it (used for
    // viaJoin.fromCube). The primary source (sources[0]) wins ties.
    const reachedByCube = new Map<string, string | null>();
    for (const src of sourceList) {
      if (!cubeMap.has(src)) continue;
      if (!reachedByCube.has(src)) reachedByCube.set(src, null);
      const neighbours = graph.adjacency.get(src) ?? new Set<string>();
      for (const n of neighbours) {
        if (!reachedByCube.has(n)) reachedByCube.set(n, src);
      }
    }

    const joinedCubeCount = Array.from(reachedByCube.entries())
      .filter(([cubeName, viaSrc]) => viaSrc !== null && !sourceList.includes(cubeName))
      .length;

    const items: ReachableMember[] = [];
    const seen = new Set<string>();
    const orderedCubes = Array.from(reachedByCube.keys()).sort((a, b) => {
      const aIsSrc = sourceList.indexOf(a);
      const bIsSrc = sourceList.indexOf(b);
      if (aIsSrc >= 0 && bIsSrc >= 0) return aIsSrc - bIsSrc;
      if (aIsSrc >= 0) return -1;
      if (bIsSrc >= 0) return 1;
      return a.localeCompare(b);
    });

    for (const cubeName of orderedCubes) {
      const cube = cubeMap.get(cubeName);
      if (!cube) continue;

      const viaSrc = reachedByCube.get(cubeName) ?? null;
      const viaJoin = viaSrc
        ? { fromCube: viaSrc, sql: graph.joinSqlByPair.get(pairKey(viaSrc, cubeName)) ?? '' }
        : undefined;

      const dimensions = cube.dimensions.map<ReachableMember>((d) => ({
        cubeName,
        memberName: d.name,
        shortName: d.name.includes('.') ? d.name.split('.').slice(1).join('.') : d.name,
        kind: 'dimension',
        viaJoin,
      }));

      const measures = cube.measures.map<ReachableMember>((m) => ({
        cubeName,
        memberName: m.name,
        shortName: m.name.includes('.') ? m.name.split('.').slice(1).join('.') : m.name,
        kind: 'measure',
        viaJoin,
      }));

      const cubeItems = [...dimensions, ...measures].sort((a, b) =>
        a.memberName.localeCompare(b.memberName)
      );

      for (const it of cubeItems) {
        if (seen.has(it.memberName)) continue;
        seen.add(it.memberName);
        items.push(it);
      }
    }

    const reachableNames = new Set(items.map((i) => i.memberName));
    return { items, reachableNames, joinedCubeCount };
  }, [cubes, sourceList]);
}
