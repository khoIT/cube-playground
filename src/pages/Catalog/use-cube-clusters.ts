import { useMemo } from 'react';
import { CatalogCube } from './use-catalog-meta';

export type CubeClusters = {
  /** Groups of joinable cubes — each group is a connectedComponent cohort */
  connected: CatalogCube[][];
  /** Cubes that have no joins (cohort size 1) or no connectedComponent at all */
  standalone: CatalogCube[];
};

/**
 * Groups cubes by `connectedComponent`. Cohorts of size >1 → `connected[]`;
 * everything else → `standalone[]`. Within each group, cubes are sorted by
 * name for stable rendering.
 */
export function useCubeClusters(cubes: CatalogCube[]): CubeClusters {
  return useMemo(() => {
    const byComponent = new Map<number, CatalogCube[]>();
    const standalone: CatalogCube[] = [];

    for (const cube of cubes) {
      if (cube.connectedComponent === undefined || cube.connectedComponent === null) {
        standalone.push(cube);
        continue;
      }
      const list = byComponent.get(cube.connectedComponent) ?? [];
      list.push(cube);
      byComponent.set(cube.connectedComponent, list);
    }

    const connected: CatalogCube[][] = [];
    for (const group of byComponent.values()) {
      if (group.length === 1) {
        standalone.push(group[0]);
      } else {
        group.sort((a, b) => a.name.localeCompare(b.name));
        connected.push(group);
      }
    }

    connected.sort((a, b) => b.length - a.length); // largest cluster first
    standalone.sort((a, b) => a.name.localeCompare(b.name));

    return { connected, standalone };
  }, [cubes]);
}
