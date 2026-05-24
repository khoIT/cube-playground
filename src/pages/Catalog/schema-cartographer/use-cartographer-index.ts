/**
 * Build a memoised, searchable index over `catalogMeta.cubes[*].members[*]`.
 * Each row keys back to its parent cube so the tree + detail panel can
 * follow `?focus=cube.member` deep links without re-querying meta.
 */
import { useMemo } from 'react';
import type { CatalogCube } from '../use-catalog-meta';

export type MemberKind = 'measure' | 'dimension' | 'segment';

export interface CartographerMember {
  cubeName: string;
  cubeTitle?: string;
  memberName: string;
  /** Fully qualified `cube.member`. */
  fqn: string;
  kind: MemberKind;
  title?: string;
  description?: string;
  type?: string;
  aggType?: string;
}

export interface CartographerIndex {
  members: CartographerMember[];
  byFqn: Map<string, CartographerMember>;
  cubes: CatalogCube[];
}

export function useCartographerIndex(cubes: ReadonlyArray<CatalogCube>): CartographerIndex {
  return useMemo(() => {
    const members: CartographerMember[] = [];
    const byFqn = new Map<string, CartographerMember>();

    for (const cube of cubes) {
      for (const m of cube.measures ?? []) {
        const fqn = `${cube.name}.${m.name}`;
        const row: CartographerMember = {
          cubeName: cube.name,
          cubeTitle: cube.title,
          memberName: m.name,
          fqn,
          kind: 'measure',
          title: m.title,
          description: m.description,
          aggType: m.aggType,
        };
        members.push(row);
        byFqn.set(fqn, row);
      }
      for (const d of cube.dimensions ?? []) {
        const fqn = `${cube.name}.${d.name}`;
        const row: CartographerMember = {
          cubeName: cube.name,
          cubeTitle: cube.title,
          memberName: d.name,
          fqn,
          kind: 'dimension',
          title: d.title,
          type: d.type,
        };
        members.push(row);
        byFqn.set(fqn, row);
      }
      for (const s of cube.segments ?? []) {
        const fqn = `${cube.name}.${s.name}`;
        const row: CartographerMember = {
          cubeName: cube.name,
          cubeTitle: cube.title,
          memberName: s.name,
          fqn,
          kind: 'segment',
          title: s.title,
          description: s.description,
        };
        members.push(row);
        byFqn.set(fqn, row);
      }
    }

    return { members, byFqn, cubes: [...cubes] };
  }, [cubes]);
}

/** Filter members by a free-text query — case-insensitive substring match. */
export function searchMembers(
  index: CartographerIndex,
  query: string,
  limit = 100,
): CartographerMember[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.members.slice(0, limit);
  const hits: CartographerMember[] = [];
  for (const m of index.members) {
    const hay = `${m.fqn} ${m.title ?? ''} ${m.description ?? ''}`.toLowerCase();
    if (hay.includes(q)) {
      hits.push(m);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
