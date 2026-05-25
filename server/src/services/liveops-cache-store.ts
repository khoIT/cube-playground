/**
 * SQLite-backed store for liveops result cache.
 *
 * Mirrors the segment_card_cache pattern: hash-skip writes keep `fetched_at`
 * stable when Cube returns the same numbers, so cron iteration doesn't
 * needlessly churn snapshot diffs. Status transitions:
 *   fresh → refreshing → fresh   (happy path)
 *   fresh → refreshing → broken  (Cube error / timeout / schema mismatch)
 */

import { createHash } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import type { LiveopsCacheResource } from './liveops-cache-config.js';

export interface CachedResultRow {
  resource: LiveopsCacheResource;
  cache_key: string;
  game: string;
  payload_json: string;
  payload_hash: string;
  cube_meta_version: string;
  fetched_at: string;
  expires_at: string;
  status: 'fresh' | 'refreshing' | 'broken';
  error_msg: string | null;
}

export interface CachedResult<T = unknown> {
  resource: LiveopsCacheResource;
  cacheKey: string;
  game: string;
  payload: T;
  payloadHash: string;
  cubeMetaVersion: string;
  fetchedAt: string;
  expiresAt: string;
  status: 'fresh' | 'refreshing' | 'broken';
  errorMsg: string | null;
}

function hashPayload(json: string): string {
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

function hydrate<T>(row: CachedResultRow): CachedResult<T> {
  return {
    resource: row.resource,
    cacheKey: row.cache_key,
    game: row.game,
    payload: JSON.parse(row.payload_json) as T,
    payloadHash: row.payload_hash,
    cubeMetaVersion: row.cube_meta_version,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    status: row.status,
    errorMsg: row.error_msg,
  };
}

export function readCache<T = unknown>(
  resource: LiveopsCacheResource,
  cacheKey: string,
): CachedResult<T> | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM liveops_result_cache WHERE resource = ? AND cache_key = ?`,
    )
    .get(resource, cacheKey) as CachedResultRow | undefined;
  return row ? hydrate<T>(row) : null;
}

export interface UpsertInput {
  resource: LiveopsCacheResource;
  cacheKey: string;
  game: string;
  payload: unknown;
  cubeMetaVersion: string;
  ttlSeconds: number;
}

/** Upsert a cache row. Skip-write when payload_hash + meta_version unchanged. */
export function upsertCache(input: UpsertInput): { wrote: boolean } {
  const db = getDb();
  const payloadJson = JSON.stringify(input.payload);
  const payloadHash = hashPayload(payloadJson);

  const now = new Date();
  const expires = new Date(now.getTime() + input.ttlSeconds * 1000);

  const existing = db
    .prepare(
      `SELECT payload_hash, cube_meta_version FROM liveops_result_cache
        WHERE resource = ? AND cache_key = ?`,
    )
    .get(input.resource, input.cacheKey) as
    | { payload_hash: string; cube_meta_version: string }
    | undefined;

  if (
    existing &&
    existing.payload_hash === payloadHash &&
    existing.cube_meta_version === input.cubeMetaVersion
  ) {
    // No-op write: bump expires_at only so cron skips this key for the next
    // TTL window, but leave fetched_at + payload alone (quiet snapshot diff).
    db.prepare(
      `UPDATE liveops_result_cache
         SET expires_at = ?, status = 'fresh', error_msg = NULL
       WHERE resource = ? AND cache_key = ?`,
    ).run(expires.toISOString(), input.resource, input.cacheKey);
    return { wrote: false };
  }

  db.prepare(
    `INSERT INTO liveops_result_cache
       (resource, cache_key, game, payload_json, payload_hash, cube_meta_version, fetched_at, expires_at, status, error_msg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fresh', NULL)
     ON CONFLICT(resource, cache_key) DO UPDATE SET
       game              = excluded.game,
       payload_json      = excluded.payload_json,
       payload_hash      = excluded.payload_hash,
       cube_meta_version = excluded.cube_meta_version,
       fetched_at        = excluded.fetched_at,
       expires_at        = excluded.expires_at,
       status            = 'fresh',
       error_msg         = NULL`,
  ).run(
    input.resource,
    input.cacheKey,
    input.game,
    payloadJson,
    payloadHash,
    input.cubeMetaVersion,
    now.toISOString(),
    expires.toISOString(),
  );
  return { wrote: true };
}

export function setStatus(
  resource: LiveopsCacheResource,
  cacheKey: string,
  status: 'refreshing' | 'broken',
  errorMsg: string | null = null,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE liveops_result_cache
       SET status = ?, error_msg = ?
     WHERE resource = ? AND cache_key = ?`,
  ).run(status, errorMsg, resource, cacheKey);
}

/** Insert a placeholder row so cron can pick the key up; called on cache-miss. */
export function ensurePlaceholder(
  resource: LiveopsCacheResource,
  cacheKey: string,
  game: string,
  cubeMetaVersion: string,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO liveops_result_cache
       (resource, cache_key, game, payload_json, payload_hash, cube_meta_version, fetched_at, expires_at, status)
     VALUES (?, ?, ?, '{}', '', ?, ?, ?, 'refreshing')`,
  ).run(resource, cacheKey, game, cubeMetaVersion, now, now);
}

export interface StaleRow {
  resource: LiveopsCacheResource;
  cacheKey: string;
  game: string;
}

/** Rows whose expires_at is in the past and aren't actively refreshing. */
export function listStale(now = new Date()): StaleRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT resource, cache_key, game
         FROM liveops_result_cache
        WHERE expires_at < ?
          AND status != 'refreshing'
        ORDER BY expires_at ASC`,
    )
    .all(now.toISOString()) as Array<{ resource: string; cache_key: string; game: string }>;
  return rows.map((r) => ({
    resource: r.resource as LiveopsCacheResource,
    cacheKey: r.cache_key,
    game: r.game,
  }));
}

/** Invalidate every row for a game/resource — used on schema-change bust. */
export function invalidate(
  resource: LiveopsCacheResource,
  game?: string,
): number {
  const db = getDb();
  if (game) {
    return db
      .prepare(
        `DELETE FROM liveops_result_cache WHERE resource = ? AND game = ?`,
      )
      .run(resource, game).changes;
  }
  return db.prepare(`DELETE FROM liveops_result_cache WHERE resource = ?`)
    .run(resource).changes;
}

/** Force expire — cron's next tick will refresh. */
export function expireKey(
  resource: LiveopsCacheResource,
  cacheKey: string,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE liveops_result_cache SET expires_at = ? WHERE resource = ? AND cache_key = ?`,
  ).run(new Date(0).toISOString(), resource, cacheKey);
}

export function logRefresh(input: {
  resource: LiveopsCacheResource;
  cacheKey: string;
  game: string;
  durationMs: number;
  status: 'ok' | 'broken' | 'skipped';
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO liveops_refresh_log (resource, cache_key, game, duration_ms, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.resource, input.cacheKey, input.game, input.durationMs, input.status);
}

/** Funnel-cache retention sweep — analysts experiment, keys multiply. */
export function pruneFunnelOlderThan(days: number): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db
    .prepare(
      `DELETE FROM liveops_result_cache
        WHERE resource = 'funnel_result' AND fetched_at < ?`,
    )
    .run(cutoff).changes;
}
