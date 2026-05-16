import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCubeClusters } from '../use-cube-clusters';
import { CatalogCube } from '../use-catalog-meta';

function cube(partial: Partial<CatalogCube> & { name: string }): CatalogCube {
  return {
    name: partial.name,
    measures: [],
    dimensions: [],
    ...partial,
  };
}

describe('useCubeClusters()', () => {
  it('returns empty when no cubes', () => {
    const { result } = renderHook(() => useCubeClusters([]));
    expect(result.current.connected).toEqual([]);
    expect(result.current.standalone).toEqual([]);
  });

  it('cubes with no connectedComponent → standalone', () => {
    const cubes = [cube({ name: 'a' }), cube({ name: 'b' })];
    const { result } = renderHook(() => useCubeClusters(cubes));
    expect(result.current.connected).toEqual([]);
    expect(result.current.standalone.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('cohort of size 1 → standalone (not connected)', () => {
    const cubes = [cube({ name: 'solo', connectedComponent: 7 })];
    const { result } = renderHook(() => useCubeClusters(cubes));
    expect(result.current.connected).toEqual([]);
    expect(result.current.standalone.map((c) => c.name)).toEqual(['solo']);
  });

  it('cohort of size ≥2 → connected group', () => {
    const cubes = [
      cube({ name: 'a', connectedComponent: 0 }),
      cube({ name: 'b', connectedComponent: 0 }),
      cube({ name: 'solo' }),
    ];
    const { result } = renderHook(() => useCubeClusters(cubes));
    expect(result.current.connected).toHaveLength(1);
    expect(result.current.connected[0].map((c) => c.name)).toEqual(['a', 'b']);
    expect(result.current.standalone.map((c) => c.name)).toEqual(['solo']);
  });

  it('multiple cohorts ordered by size desc', () => {
    const cubes = [
      cube({ name: 'small1', connectedComponent: 1 }),
      cube({ name: 'small2', connectedComponent: 1 }),
      cube({ name: 'big1', connectedComponent: 2 }),
      cube({ name: 'big2', connectedComponent: 2 }),
      cube({ name: 'big3', connectedComponent: 2 }),
    ];
    const { result } = renderHook(() => useCubeClusters(cubes));
    expect(result.current.connected[0]).toHaveLength(3);
    expect(result.current.connected[1]).toHaveLength(2);
  });

  it('standalones sorted alphabetically', () => {
    const cubes = [
      cube({ name: 'zebra' }),
      cube({ name: 'apple' }),
      cube({ name: 'mango' }),
    ];
    const { result } = renderHook(() => useCubeClusters(cubes));
    expect(result.current.standalone.map((c) => c.name)).toEqual(['apple', 'mango', 'zebra']);
  });
});
