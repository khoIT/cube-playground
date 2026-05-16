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
 * Derive all members reachable from sourceCube in one hop.
 * Source-cube members have viaJoin === undefined.
 * Joined-cube members carry viaJoin.sql verbatim from meta.
 *
 * Memoised on (cubes reference, sourceCube).
 */
export function useReachableMembers(sourceCube: string | null): {
  items: ReachableMember[];
  reachableNames: Set<string>;
  joinedCubeCount: number;
} {
  const { cubes } = useQueryBuilderContext();

  return useMemo(() => {
    const empty = { items: [], reachableNames: new Set<string>(), joinedCubeCount: 0 };
    if (!sourceCube) return empty;

    const graph = buildJoinGraph(cubes);
    const cubeMap = new Map<string, CubeWithJoins>(
      (cubes as CubeWithJoins[]).map((c) => [c.name, c])
    );

    if (!cubeMap.has(sourceCube)) return empty;

    const neighbours = graph.adjacency.get(sourceCube) ?? new Set<string>();
    const joinedCubeCount = neighbours.size;

    const reachableCubes = [sourceCube, ...Array.from(neighbours).sort()];
    const items: ReachableMember[] = [];

    for (const cubeName of reachableCubes) {
      const cube = cubeMap.get(cubeName);
      if (!cube) continue;

      const isSource = cubeName === sourceCube;
      const viaJoin = isSource
        ? undefined
        : {
            fromCube: sourceCube,
            sql: graph.joinSqlByPair.get(pairKey(sourceCube, cubeName)) ?? '',
          };

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

      // Source cube: measures then dimensions (preserves existing stub order);
      // joined cubes: alphabetical by member name within each cube
      const cubeItems = [...dimensions, ...measures].sort((a, b) =>
        a.memberName.localeCompare(b.memberName)
      );

      items.push(...cubeItems);
    }

    const reachableNames = new Set(items.map((i) => i.memberName));
    return { items, reachableNames, joinedCubeCount };
  }, [cubes, sourceCube]);
}
