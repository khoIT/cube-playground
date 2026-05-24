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

// /meta returns member `name` as the full FQN (`active_daily.dau`), but our
// fixtures and earlier callers sometimes pass just the local part (`dau`).
// Resolve both shapes so the catalog stays stable across data sources and
// the produced fqn never carries a doubled cube prefix.
export function resolveMemberNames(
  cubeName: string,
  raw: string,
): { fqn: string; local: string } {
  const prefix = `${cubeName}.`;
  if (raw.startsWith(prefix)) {
    return { fqn: raw, local: raw.slice(prefix.length) };
  }
  return { fqn: `${cubeName}.${raw}`, local: raw };
}

// Historic links produced fqns with the cube name appearing twice
// (`mf_users.mf_users.dau`) before resolveMemberNames was in place. Strip the
// duplicate prefix so old bookmarks / cached chat field-chips still resolve.
export function normaliseFqn(raw: string): string {
  const parts = raw.split('.');
  if (parts.length >= 3 && parts[0] === parts[1]) {
    return parts.slice(1).join('.');
  }
  return raw;
}

function conceptsFromCube(cube: CatalogCube): Concept[] {
  const out: Concept[] = [];
  const cubeKind: 'cube' | 'view' = cube.type === 'view' ? 'view' : 'cube';

  for (const m of cube.measures) {
    const { fqn, local } = resolveMemberNames(cube.name, m.name);
    out.push({
      type: 'measure',
      cubeKind,
      fqn,
      cube: cube.name,
      name: local,
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
    const { fqn, local } = resolveMemberNames(cube.name, d.name);
    out.push({
      type: 'dimension',
      cubeKind,
      fqn,
      cube: cube.name,
      name: local,
      title: d.title,
      meta: {
        dimensionType: d.type,
        primaryKey: d.primaryKey,
        source: cube.meta?.cdp_source as string | undefined,
      },
    });
  }

  for (const s of cube.segments ?? []) {
    const { fqn, local } = resolveMemberNames(cube.name, s.name);
    out.push({
      type: 'segment',
      cubeKind,
      fqn,
      cube: cube.name,
      name: local,
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
