/**
 * Unified key-value cache store, backed by the `kv_cache` table.
 *
 * Cache surfaces (cube /load row cache, turn-detail audit cache, etc.) each
 * supply their own `kind` discriminator and key-hashing scheme; this module
 * handles row layout, hit-count bookkeeping, and TTL eviction in one place.
 *
 * Reads transparently treat expired rows as misses (without deleting them on
 * the read path — sweepExpired drops them in bulk).
 */

import type Database from 'better-sqlite3';

/** Optional metadata stored alongside a cache value. All fields are nullable. */
export interface KvCachePutMeta {
  ownerId?: string;
  gameId?: string;
  metaHash?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** Absolute epoch ms after which the row is considered stale. Omit for no TTL. */
  expiresAt?: number;
}

export interface KvCachePutParams extends KvCachePutMeta {
  kind: string;
  key: string;
  valueJson: string;
  /** Defaults to Date.now() when omitted. Exposed for deterministic tests. */
  now?: number;
}

export interface KvCacheRow {
  kind: string;
  key: string;
  valueJson: string;
  ownerId: string | null;
  gameId: string | null;
  metaHash: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  hitCount: number;
  createdAt: number;
  lastHitAt: number | null;
  expiresAt: number | null;
}

// ---------------------------------------------------------------------------
// Internal row mapping
// ---------------------------------------------------------------------------

interface RawRow {
  kind: string;
  key: string;
  value_json: string;
  owner_id: string | null;
  game_id: string | null;
  meta_hash: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  hit_count: number;
  created_at: number;
  last_hit_at: number | null;
  expires_at: number | null;
}

function fromRaw(r: RawRow): KvCacheRow {
  return {
    kind: r.kind,
    key: r.key,
    valueJson: r.value_json,
    ownerId: r.owner_id,
    gameId: r.game_id,
    metaHash: r.meta_hash,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    hitCount: r.hit_count,
    createdAt: r.created_at,
    lastHitAt: r.last_hit_at,
    expiresAt: r.expires_at,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a row. Returns null on miss and on expired rows (treated as miss
 * without deletion — sweepExpired drops them in bulk on a schedule).
 * On hit, increments hit_count and updates last_hit_at as a side effect.
 */
export function kvGet(
  db: Database.Database,
  kind: string,
  key: string,
  now: number = Date.now(),
): KvCacheRow | null {
  const raw = db.prepare(
    `SELECT * FROM kv_cache WHERE kind = ? AND key = ?`,
  ).get(kind, key) as RawRow | undefined;
  if (!raw) return null;
  if (raw.expires_at != null && raw.expires_at <= now) return null;

  db.prepare(
    `UPDATE kv_cache SET hit_count = hit_count + 1, last_hit_at = ?
     WHERE kind = ? AND key = ?`,
  ).run(now, kind, key);

  return fromRaw({ ...raw, hit_count: raw.hit_count + 1, last_hit_at: now });
}

/** Insert or replace a cache row. Resets hit_count to 0 on replace. */
export function kvPut(db: Database.Database, params: KvCachePutParams): void {
  const now = params.now ?? Date.now();
  db.prepare(
    `INSERT INTO kv_cache
       (kind, key, value_json, owner_id, game_id, meta_hash, model,
        input_tokens, output_tokens, cost_usd, hit_count,
        created_at, last_hit_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
     ON CONFLICT(kind, key) DO UPDATE SET
       value_json = excluded.value_json,
       owner_id = excluded.owner_id,
       game_id = excluded.game_id,
       meta_hash = excluded.meta_hash,
       model = excluded.model,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cost_usd = excluded.cost_usd,
       hit_count = 0,
       created_at = excluded.created_at,
       last_hit_at = NULL,
       expires_at = excluded.expires_at`,
  ).run(
    params.kind,
    params.key,
    params.valueJson,
    params.ownerId ?? null,
    params.gameId ?? null,
    params.metaHash ?? null,
    params.model ?? null,
    params.inputTokens ?? null,
    params.outputTokens ?? null,
    params.costUsd ?? null,
    now,
    params.expiresAt ?? null,
  );
}

/** Remove a specific (kind, key). Returns true if a row was deleted. */
export function kvEvict(db: Database.Database, kind: string, key: string): boolean {
  const info = db.prepare(`DELETE FROM kv_cache WHERE kind = ? AND key = ?`).run(kind, key);
  return info.changes > 0;
}

/** Remove every row of a given kind. Returns the count deleted. */
export function kvEvictByKind(db: Database.Database, kind: string): number {
  const info = db.prepare(`DELETE FROM kv_cache WHERE kind = ?`).run(kind);
  return info.changes;
}

/** Drop expired rows across all kinds. Returns the count deleted. */
export function kvSweepExpired(db: Database.Database, now: number = Date.now()): number {
  const info = db.prepare(
    `DELETE FROM kv_cache WHERE expires_at IS NOT NULL AND expires_at <= ?`,
  ).run(now);
  return info.changes;
}

/** Lightweight count for monitoring; cheap because PK index is enough. */
export function kvCountByKind(db: Database.Database, kind: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM kv_cache WHERE kind = ?`,
  ).get(kind) as { cnt: number };
  return row.cnt;
}
