/**
 * LRU TTL cache for Cube /meta responses, keyed by gameId.
 * Fetches from ${SERVER_BASE_URL}/cubejs-api/v1/meta using the per-request cube token.
 * TTL: 60 seconds.
 */

import { LRUCache } from 'lru-cache';
import { config } from '../config.js';

interface MetaCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
  fetchedAt: number;
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

/** Invalidate the cache entry for a game (useful for tests). */
export function invalidate(gameId: string): void {
  cache.delete(gameId);
}
