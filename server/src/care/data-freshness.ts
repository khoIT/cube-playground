/**
 * Per-cube "data as-of" resolver for the CS care surfaces.
 *
 * A playbook is only as current as the cube backing it. Spend / activity marts
 * refresh to real today; the gameplay/clan mart is anchored to the latest match
 * day the warehouse holds (weeks behind real time), so its cohorts are a
 * snapshot of that day, not now. Reading a stale cohort as "today" is the
 * failure this surfaces: resolve the freshest date each backing cube actually
 * holds so the console can stamp every playbook row + the header with it.
 *
 * Freshness = MAX of the cube's canonical date dimension (prefers a `log_date`
 * field, else the cube's first declared time dimension). For an as-of-anchored
 * mart every row shares that date, so the MAX is exactly the anchor; for a live
 * snapshot it is the latest event date — which lands on real today.
 */

import { type WorkspaceCtx } from '../services/cube-client.js';
import { logicalCube, physicalMember } from '../services/cube-member-resolver.js';
import { resolveDataAnchor, type AnchorLoader } from './resolve-data-anchor.js';

interface MetaDimension {
  name: string;
  type?: string;
}
interface MetaCube {
  name: string;
  dimensions?: MetaDimension[];
}
interface MetaResponse {
  cubes?: MetaCube[];
}

/** The logical field of a `cube.field` meta member (drops the cube prefix). */
function fieldOf(dim: MetaDimension): string {
  return dim.name.split('.').slice(1).join('.') || dim.name;
}

/**
 * Map each logical cube → its canonical time-dimension logical member
 * (`cube.field`). Prefers a dimension whose field is `log_date` (the marts'
 * as-of date), else the cube's first declared time dimension. Cubes without a
 * time dimension are omitted — there's nothing to date them by.
 *
 * Prefix handling mirrors `extractLogicalMembers`: on a prefix workspace keep
 * only the requested game's cubes and strip the prefix, so the freshness map
 * keys match the logical cube names the registry's `dataRequirements` use.
 */
export function extractCubeTimeDimensions(
  meta: unknown,
  gamePrefix: string | null = null,
): Map<string, string> {
  const cubes = (meta as MetaResponse)?.cubes ?? [];
  const out = new Map<string, string>();
  for (const cube of cubes) {
    if (gamePrefix && !cube.name.startsWith(`${gamePrefix}_`)) continue;
    const cubeName = gamePrefix ? logicalCube(cube.name, gamePrefix) : cube.name;
    const timeDims = (cube.dimensions ?? []).filter((d) => d.type === 'time');
    if (timeDims.length === 0) continue;
    const preferred = timeDims.find((d) => fieldOf(d) === 'log_date') ?? timeDims[0];
    out.set(cubeName, `${cubeName}.${fieldOf(preferred)}`);
  }
  return out;
}

/** Format a Date to a local `YYYY-MM-DD` — matches the local-midnight parse in
 *  resolveDataAnchor so the calendar day never shifts across the round-trip. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve `cube → YYYY-MM-DD` for `cubes`, probing MAX(timeDim) in parallel
 * (each probe is cached ~10 min by resolveDataAnchor, so repeat loads are free
 * and cubes shared by many playbooks probe once). Cubes with no time dimension
 * in /meta are skipped. Never throws — a failed probe falls back to today inside
 * resolveDataAnchor, so the surface always has a date.
 */
export async function resolveCubeFreshness(
  ctx: WorkspaceCtx,
  meta: unknown,
  gamePrefix: string | null,
  gameId: string,
  cacheKey: string,
  cubes: Iterable<string>,
  loader?: AnchorLoader,
): Promise<Record<string, string>> {
  const timeDims = extractCubeTimeDimensions(meta, gamePrefix);
  const wanted = [...new Set(cubes)].filter((c) => timeDims.has(c));
  const entries = await Promise.all(
    wanted.map(async (cube) => {
      // The freshness map keys on the LOGICAL cube (to match the registry's
      // dataRequirements), but a prefix workspace's Cube instance only exposes
      // PHYSICAL (prefixed) member names — so probe with the physical member or
      // the MAX query 404s and silently falls back to today, mislabelling a
      // lagging mart as fresh. physicalMember is a no-op on a game_id workspace
      // (gamePrefix null), keeping local behaviour unchanged.
      const member = physicalMember(timeDims.get(cube)!, gamePrefix);
      const date = loader
        ? await resolveDataAnchor(ctx, member, gameId, cacheKey, loader)
        : await resolveDataAnchor(ctx, member, gameId, cacheKey);
      return [cube, toIsoDate(date)] as const;
    }),
  );
  return Object.fromEntries(entries);
}
