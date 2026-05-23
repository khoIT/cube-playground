/**
 * useConcepts — derives a flat Concept[] list from useCatalogMeta(). One
 * concept per measure / non-private dimension / segment, with FQN as the
 * stable identifier. Private dims (`public: false`) and primary keys are
 * filtered out — the Data Model surface is for *queryable* concepts.
 */

import { useMemo } from 'react';

import { useCatalogMeta } from '../use-catalog-meta';
import type { CatalogCube } from '../use-catalog-meta';
import type { Concept } from './concept-types';

function isQueryableDim(dim: CatalogCube['dimensions'][number]): boolean {
  if (dim.public === false) return false;
  if (dim.primaryKey) return false;
  return true;
}

function conceptsFromCube(cube: CatalogCube): Concept[] {
  const out: Concept[] = [];
  const cubeKind: 'cube' | 'view' = cube.type === 'view' ? 'view' : 'cube';

  for (const m of cube.measures) {
    out.push({
      type: 'measure',
      cubeKind,
      fqn: `${cube.name}.${m.name}`,
      cube: cube.name,
      name: m.name,
      title: m.title,
      description: m.description,
      meta: {
        aggType: m.aggType,
        format: m.format,
        source: cube.meta?.cdp_source as string | undefined,
        cdpProjection: typeof cube.meta?.cdp_source === 'string',
      },
    });
  }

  for (const d of cube.dimensions) {
    if (!isQueryableDim(d)) continue;
    out.push({
      type: 'dimension',
      cubeKind,
      fqn: `${cube.name}.${d.name}`,
      cube: cube.name,
      name: d.name,
      title: d.title,
      meta: {
        dimensionType: d.type,
        primaryKey: d.primaryKey,
        source: cube.meta?.cdp_source as string | undefined,
      },
    });
  }

  for (const s of cube.segments ?? []) {
    out.push({
      type: 'segment',
      cubeKind,
      fqn: `${cube.name}.${s.name}`,
      cube: cube.name,
      name: s.name,
      title: s.title,
      description: s.description,
      meta: {
        source: cube.meta?.cdp_source as string | undefined,
      },
    });
  }

  return out;
}

interface UseConceptsResult {
  concepts: Concept[];
  cubes: CatalogCube[];
  loading: boolean;
  error: string | null;
}

export function useConcepts(): UseConceptsResult {
  const { cubes, loading, error } = useCatalogMeta();
  const concepts = useMemo(() => {
    return cubes
      .filter((c) => c.public !== false && c.isVisible !== false)
      .flatMap(conceptsFromCube);
  }, [cubes]);
  return { concepts, cubes, loading, error };
}
