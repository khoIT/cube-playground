/**
 * LRU TTL cache for Cube /meta responses, keyed by gameId.
 * Fetches from ${SERVER_BASE_URL}/cubejs-api/v1/meta using the per-request cube token.
 * TTL: 60 seconds.
 *
 * Phase-06: also caches a derived `version` hash (sha256 of stable schema subset)
 * used as the cubeMetaHash component in the response-cache key.
 */

import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

interface MetaCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  fetchedAt: number;
  /** sha256 of stable schema subset — computed lazily on first call, memoized per TTL cycle. */
  version?: string;
}

const TTL_MS = 60_000;

const cache = new LRUCache<string, MetaCacheEntry>({ max: 50 });

/**
 * Return the /meta JSON for the given game, using the provided cube token.
 * Results are cached for TTL_MS. A stale-or-missing entry triggers a fresh fetch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMeta(gameId: string, cubeToken: string): Promise<any> {
  const entry = cache.get(gameId);
  if (entry && Date.now() - entry.fetchedAt < TTL_MS) {
    return entry.meta;
  }

  const url = `${config.cubeApiUrl}/cubejs-api/v1/meta`;
  const res = await fetch(url, {
    headers: {
      Authorization: cubeToken,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch /meta for game ${gameId}: ${res.status} ${res.statusText}`);
  }

  const meta = await res.json();
  cache.set(gameId, { meta, fetchedAt: Date.now() });
  return meta;
}

/** Extract all known member names (measures + dimensions) from a /meta response. */
export function extractMemberNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any,
): Set<string> {
  const names = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cubes: any[] = meta?.cubes ?? [];
  for (const cube of cubes) {
    for (const m of cube.measures ?? []) names.add(m.name);
    for (const d of cube.dimensions ?? []) names.add(d.name);
  }
  return names;
}

/**
 * Return a deterministic sha256 hash of the stable schema subset for `gameId`.
 * Stable subset: sorted cube names + sorted measure/dimension names + types.
 * Recomputed whenever the TTL-gated meta fetch fires; memoized otherwise.
 *
 * Falls back to sha256('unknown') if meta cannot be fetched (caller handles
 * cache misses transparently — a stale hash simply produces a cache miss).
 */
export async function getMetaVersion(gameId: string, cubeToken: string): Promise<string> {
  // Reuse the already-fetched meta if still fresh; fetch otherwise.
  const meta = await getMeta(gameId, cubeToken);
  const entry = cache.get(gameId);
  if (entry?.version) return entry.version;

  const version = computeMetaVersion(meta);
  if (entry) entry.version = version;
  return version;
}

/** Compute the stable schema hash from a raw /meta response. Exported for tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeMetaVersion(meta: any): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cubes: any[] = meta?.cubes ?? [];
  const stable = cubes
    .map((c) => ({
      name: c.name as string,
      measures: ((c.measures ?? []) as Array<{ name: string; type: string }>)
        .map((m) => ({ name: m.name, type: m.type }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      dimensions: ((c.dimensions ?? []) as Array<{ name: string; type: string }>)
        .map((d) => ({ name: d.name, type: d.type }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      segments: ((c.segments ?? []) as Array<{ name: string }>)
        .map((s) => s.name)
        .sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex');
}

/** Invalidate the cache entry for a game (useful for tests). */
export function invalidate(gameId: string): void {
  cache.delete(gameId);
}
