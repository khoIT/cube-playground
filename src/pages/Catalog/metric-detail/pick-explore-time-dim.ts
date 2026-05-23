/**
 * Pick a real time dimension for the explore drill-down. The previous
 * convention assumed every cube exposed `<cube>.event_date`, but the
 * current schema uses `log_date` / `recharge_date` / `install_date` etc.
 * — so the hardcoded constant produced URLs the Cube backend rejected
 * with "X not found".
 *
 * Strategy: consult /meta, prefer event-like dims in a stable order,
 * fall back to the cube's first time-typed dim. Returns null when the
 * cube has no time dim or isn't in meta — callers should then omit
 * `timeDimensions` entirely (still a valid Cube query).
 */

import type { CatalogCube } from '../use-catalog-meta';

const PREFERRED_TIME_DIM_NAMES = [
  'log_date',
  'event_date',
  'recharge_date',
  'first_active_date',
  'last_active_date',
  'install_date',
];

export function pickExploreTimeDim(
  cubes: CatalogCube[] | null | undefined,
  cubeName: string,
): string | null {
  if (!cubes || cubes.length === 0) return null;
  const cube = cubes.find((c) => c.name === cubeName);
  if (!cube) return null;

  const timeDims = (cube.dimensions ?? []).filter((d) => d.type === 'time');
  if (timeDims.length === 0) return null;

  for (const pref of PREFERRED_TIME_DIM_NAMES) {
    const fqn = `${cubeName}.${pref}`;
    const match = timeDims.find((d) => d.name === fqn);
    if (match) return match.name;
  }

  return timeDims[0].name;
}
