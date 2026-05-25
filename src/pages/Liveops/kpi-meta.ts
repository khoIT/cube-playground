/**
 * Meta-level helpers for Live KPI gap detection.
 * Probes Cube /meta to determine which cubes exist for the active game.
 */

import type { CubeMetaLike } from './use-live-kpis-types';

/**
 * Returns true when active_daily cube is present in /meta.
 * Games without it (e.g. muaw, ptg recharge-only) render DAU/MAU/ARPDAU as "—".
 * Fails open: if /meta itself errors, assume the cube exists.
 */
export async function hasActiveDailyCube(api: CubeMetaLike): Promise<boolean> {
  try {
    const meta = await api.meta();
    const cubes: Array<{ name: string }> =
      meta.cubes ?? (Object.values(meta.cubesMap ?? {}) as Array<{ name: string }>);
    return cubes.some((c) => c.name === 'active_daily');
  } catch {
    return true;
  }
}
