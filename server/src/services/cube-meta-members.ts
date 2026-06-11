/**
 * Cube /meta member catalog as fast name-lookup sets — which fully-qualified
 * members exist, split by kind (measure vs dimension). Refresh-time consumers
 * (rank-measure picker, member-profile runner) use it to (a) tell whether a
 * segment filter targets a measure and (b) drop preset member columns a game's
 * model doesn't have, instead of letting one unknown member 400 a whole query.
 *
 * Mirrors cube-meta-version's fetch posture: game-scoped token, short TTL
 * cache, default-workspace Cube URL (the same base every refresh query hits).
 */

import { getMeta } from './cube-client.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';

interface MetaMember {
  name: string;
}

interface MetaCube {
  name: string;
  measures?: MetaMember[];
  dimensions?: MetaMember[];
}

interface MetaShape {
  cubes?: MetaCube[];
  cubesMap?: Record<string, MetaCube>;
}

export interface MetaMemberSets {
  /** Fully-qualified PHYSICAL measure names (e.g. `mf_users.ltv_total_vnd`). */
  measures: Set<string>;
  /** Fully-qualified PHYSICAL dimension names. */
  dimensions: Set<string>;
}

const CACHE_TTL_MS = 5 * 60_000;

const cache = new Map<string, { sets: MetaMemberSets; fetchedAt: number }>();

function extractCubes(meta: MetaShape): MetaCube[] {
  if (Array.isArray(meta.cubes)) return meta.cubes;
  if (meta.cubesMap) return Object.values(meta.cubesMap);
  return [];
}

/**
 * Fetch (or serve cached) member sets for a game's /meta. Returns null on any
 * failure — callers treat "no meta" as "validate nothing", never as an error
 * that could break or delay a refresh.
 */
export async function getMetaMemberSets(gameId: string | null): Promise<MetaMemberSets | null> {
  const key = gameId ?? '__default__';
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.sets;

  try {
    const token = gameId ? resolveCubeTokenForGame(gameId) ?? undefined : undefined;
    const meta = (await getMeta(token)) as MetaShape;
    const sets: MetaMemberSets = { measures: new Set(), dimensions: new Set() };
    for (const cube of extractCubes(meta)) {
      for (const m of cube.measures ?? []) sets.measures.add(m.name);
      for (const d of cube.dimensions ?? []) sets.dimensions.add(d.name);
    }
    // An empty catalog means the fetch "succeeded" against a broken/foreign
    // ctx — caching it would suppress all validation for the TTL window.
    if (sets.measures.size === 0 && sets.dimensions.size === 0) return null;
    cache.set(key, { sets, fetchedAt: Date.now() });
    return sets;
  } catch {
    return null;
  }
}

/** Test-only reset. */
export function __resetMetaMemberSetsCache(): void {
  cache.clear();
}
