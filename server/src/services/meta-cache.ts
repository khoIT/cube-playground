/**
 * In-memory cache for the Cube /meta SHA-256 hash.
 * Callers use getVersion() to retrieve the current hash without hammering Cube.
 */

import { createHash } from 'node:crypto';
import { getMeta } from './cube-client.js';

const TTL_MS = 60_000;

interface CacheState {
  hash: string | null;
  fetchedAt: number;
}

const state: CacheState = {
  hash: null,
  fetchedAt: 0,
};

function hashMeta(meta: unknown): string {
  return createHash('sha256').update(JSON.stringify(meta)).digest('hex');
}

/**
 * Return the current /meta hash.
 * Fetches from Cube when the cache is cold or expired, or when force=true.
 */
export async function getVersion(force = false): Promise<CacheState> {
  const now = Date.now();
  const stale = now - state.fetchedAt > TTL_MS;

  if (!force && !stale && state.hash !== null) {
    return { ...state };
  }

  const meta = await getMeta();
  state.hash = hashMeta(meta);
  state.fetchedAt = Date.now();

  return { ...state };
}

/** Reset cache — used in tests. */
export function resetCache(): void {
  state.hash = null;
  state.fetchedAt = 0;
}
