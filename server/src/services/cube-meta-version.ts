/**
 * Per-game hash of the relevant Cube member surface (cube names, measures,
 * dimensions for cubes used by liveops/dashboards). Stored alongside cache
 * rows so a YAML redeploy or measure rename can bust stored payloads — a
 * shape mismatch on read returns 202 + triggers re-fill instead of feeding
 * the FE a wrong-shaped row.
 *
 * Cheap to compute and bounded: we hash a stable subset (sorted), not the
 * full /meta blob, so unrelated edits (descriptions, formats) don't churn
 * the version unnecessarily.
 */

import { createHash } from 'node:crypto';
import { getMeta } from './cube-client.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';

interface CubeMember { name: string }
interface MetaCube {
  name: string;
  measures?: CubeMember[];
  dimensions?: CubeMember[];
}
interface MetaShape {
  cubes?: MetaCube[];
  cubesMap?: Record<string, MetaCube>;
}

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  version: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function extractCubes(meta: MetaShape): MetaCube[] {
  if (Array.isArray(meta.cubes)) return meta.cubes;
  if (meta.cubesMap) return Object.values(meta.cubesMap);
  return [];
}

/** Reduce /meta to its shape-relevant surface and hash it. */
function hashShape(cubes: MetaCube[]): string {
  const shape = cubes
    .map((c) => ({
      n: c.name,
      m: (c.measures ?? []).map((m) => m.name).sort(),
      d: (c.dimensions ?? []).map((d) => d.name).sort(),
    }))
    .sort((a, b) => a.n.localeCompare(b.n));
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

export async function getCubeMetaVersion(game: string): Promise<string> {
  const cached = cache.get(game);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.version;
  }
  const token = resolveCubeTokenForGame(game) ?? undefined;
  const meta = (await getMeta(token)) as MetaShape;
  const version = hashShape(extractCubes(meta));
  cache.set(game, { version, fetchedAt: Date.now() });
  return version;
}

/** Test-only reset. */
export function __resetCubeMetaVersionCache(): void {
  cache.clear();
}
