/**
 * FE port of `server/src/services/metric-ref-validator.ts`.
 * Pure helper: given a metric and a catalog meta snapshot (list of cubes
 * with their measures/dimensions), returns the refs that don't resolve to
 * a real Cube member.
 *
 * Keep the algorithm in lockstep with the server validator — a vitest
 * fixture exercises both against the same input.
 */

import type { BusinessMetric } from '../pages/Catalog/metrics-tab/business-metric-types';
import type { CatalogCube } from '../pages/Catalog/use-catalog-meta';

export interface MetaSnapshotFE {
  members: Set<string>;
  cubes: Set<string>;
}

export function extractRefs(metric: BusinessMetric): string[] {
  const f = metric.formula;
  if (f.type === 'measure') return [f.ref];
  if (f.type === 'ratio') return [f.numerator, f.denominator];
  if (f.type === 'expression') return [...(f.inputs ?? [])];
  return [];
}

export function snapshotFromCubes(cubes: CatalogCube[]): MetaSnapshotFE {
  const members = new Set<string>();
  const cubeNames = new Set<string>();
  for (const cube of cubes) {
    cubeNames.add(cube.name);
    for (const m of cube.measures ?? []) members.add(m.name);
    for (const d of cube.dimensions ?? []) members.add(d.name);
  }
  return { members, cubes: cubeNames };
}

/**
 * Returns refs that don't resolve against the snapshot. A ref is unresolved
 * if it doesn't parse as `cube.member`, or its cube/member doesn't exist
 * in the snapshot. Mirrors `metric-ref-validator.validateRefs` so server
 * and client agree on "broken".
 */
export function findMissingRefs(
  metric: BusinessMetric,
  snapshot: MetaSnapshotFE,
): string[] {
  const out: string[] = [];
  for (const ref of extractRefs(metric)) {
    const dot = ref.indexOf('.');
    if (dot <= 0 || dot === ref.length - 1) {
      out.push(ref);
      continue;
    }
    const cube = ref.slice(0, dot);
    if (!snapshot.cubes.has(cube)) {
      out.push(ref);
      continue;
    }
    if (!snapshot.members.has(ref)) {
      out.push(ref);
    }
  }
  return out;
}
