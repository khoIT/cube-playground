/**
 * Derive which physical cubes compose each Cube view from the `aliasMember`
 * extended meta puts on every view dimension/measure (`view.field` proxies
 * `source_cube.field`). Drives the graph's view-highlight select.
 */
import type { CatalogCube } from '../use-catalog-meta';

/** viewName → set of source cube names referenced by its members. */
export function viewComposition(cubes: CatalogCube[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const cube of cubes) {
    if (cube.type !== 'view') continue;
    const sources = new Set<string>();
    for (const member of [...cube.dimensions, ...cube.measures]) {
      const alias = member.aliasMember;
      if (!alias) continue;
      const dot = alias.indexOf('.');
      if (dot > 0) sources.add(alias.slice(0, dot));
    }
    out.set(cube.name, sources);
  }
  return out;
}
