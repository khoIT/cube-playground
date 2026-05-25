/**
 * Cache adapter for Cube /load query results.
 *
 * Wraps kv-cache-store with kind='load'. Key is sha256 over a normalised
 * (recursively key-sorted) query JSON + gameId + cubeMetaHash so semantically
 * equivalent queries hash identically regardless of caller key order.
 *
 * Invalidation:
 *   - meta_hash baked into key — schema changes naturally invalidate.
 *   - TTL (default 10 min) bounds staleness for in-place cube data changes.
 *
 * Multi-user scoping: not implemented yet. Cache is per-(query, gameId,
 * metaHash), shared across owners within a game. Acceptable today because all
 * traffic runs under a single 'dev' owner; revisit when multi-owner access
 * lands (key must add ownerId or this cache must be disabled).
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import type { CubeQuery } from '../types.js';
import { kvGet, kvPut } from './kv-cache-store.js';

const KIND = 'load';
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type LoadCachedRows = Record<string, string | number>[];

interface CachedPayload {
  rows: LoadCachedRows;
}

/**
 * Recursively sort object keys so that two semantically-identical queries
 * stringify to the same bytes regardless of key insertion order.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = normalize(obj[k]);
      return acc;
    }, {});
  }
  return value;
}

export function loadCacheKey(
  query: CubeQuery,
  gameId: string,
  metaHash: string | null,
): string {
  const normalised = normalize(query);
  return createHash('sha256')
    .update(JSON.stringify({ q: normalised, g: gameId, h: metaHash ?? '' }))
    .digest('hex');
}

export interface GetLoadCacheParams {
  query: CubeQuery;
  gameId: string;
  metaHash: string | null;
}

/** Returns cached rows or null on miss / when cache service is disabled. */
export function getCachedLoad(
  db: Database.Database,
  params: GetLoadCacheParams,
): LoadCachedRows | null {
  if (!config.cacheServiceEnabled) return null;
  const key = loadCacheKey(params.query, params.gameId, params.metaHash);
  const row = kvGet(db, KIND, key);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.valueJson) as CachedPayload;
    return parsed.rows;
  } catch {
    // Corrupt row — treat as miss; caller will refetch and overwrite via put.
    return null;
  }
}

export interface PutLoadCacheParams extends GetLoadCacheParams {
  rows: LoadCachedRows;
  /** Override default TTL (10 minutes). */
  ttlMs?: number;
}

/** Persist rows in the load cache. No-op when cache service is disabled. */
export function putCachedLoad(db: Database.Database, params: PutLoadCacheParams): void {
  if (!config.cacheServiceEnabled) return;
  const key = loadCacheKey(params.query, params.gameId, params.metaHash);
  const now = Date.now();
  kvPut(db, {
    kind: KIND,
    key,
    valueJson: JSON.stringify({ rows: params.rows } satisfies CachedPayload),
    gameId: params.gameId,
    metaHash: params.metaHash ?? undefined,
    expiresAt: now + (params.ttlMs ?? DEFAULT_TTL_MS),
    now,
  });
}
