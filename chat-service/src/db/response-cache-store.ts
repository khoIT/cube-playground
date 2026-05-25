/**
 * DB operations for the `response_cache` table.
 *
 * All reads/writes are synchronous (better-sqlite3).
 * Exported functions:
 *   getByKey        — lookup + hit-count increment on hit
 *   insertCacheEntry — INSERT OR IGNORE (idempotent on key collision)
 *   incrementHit    — UPDATE hit_count + last_hit_at (called after replay)
 *   purgeExpired    — DELETE rows older than a cutoff; bounded to 500 per call
 *   clearForGame    — DELETE all rows for a game_id (phase-08 hook)
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed value stored in response_cache.value_json. */
export interface CachedValue {
  text: string;
  toolCalls: never[];
}

/** Full row as returned by the DB. */
export interface CachedResponse {
  key: string;
  game_id: string;
  skill: string;
  model: string;
  user_text_normalized: string;
  value_json: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  hit_count: number;
  created_at: number;
  last_hit_at: number | null;
  original_turn_id: string;
  original_session_id: string;
  /** Populated on writes after the cube_meta_hash migration. NULL for legacy rows. */
  cube_meta_hash: string | null;
}

export interface InsertCacheParams {
  key: string;
  gameId: string;
  skill: string;
  model: string;
  userTextNormalized: string;
  value: CachedValue;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  originalTurnId: string;
  originalSessionId: string;
  /** The cube meta version hash that was mixed into the cache key. NULL allowed for backwards compat. */
  cubeMetaHash?: string | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Look up a cache row by key. Returns null on miss.
 * Does NOT increment hit_count here — caller calls incrementHit separately
 * after emitting the replay, so a failed replay doesn't inflate the count.
 */
export function getByKey(db: Database.Database, key: string): CachedResponse | null {
  return (
    (db
      .prepare('SELECT * FROM response_cache WHERE key = ?')
      .get(key) as CachedResponse | undefined) ?? null
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * INSERT OR IGNORE — idempotent on PRIMARY KEY collision.
 * The first writer wins; concurrent losers are silently dropped.
 */
export function insertCacheEntry(db: Database.Database, params: InsertCacheParams): void {
  db.prepare(
    `INSERT OR IGNORE INTO response_cache
       (key, game_id, skill, model, user_text_normalized, value_json,
        input_tokens, output_tokens, cost_usd,
        hit_count, created_at, last_hit_at,
        original_turn_id, original_session_id, cube_meta_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?)`,
  ).run(
    params.key,
    params.gameId,
    params.skill,
    params.model,
    params.userTextNormalized,
    JSON.stringify(params.value),
    params.inputTokens,
    params.outputTokens,
    params.costUsd,
    Date.now(),
    params.originalTurnId,
    params.originalSessionId,
    params.cubeMetaHash ?? null,
  );
}

/**
 * Increment hit_count and update last_hit_at for the given key.
 * Called after a successful cache replay.
 */
export function incrementHit(db: Database.Database, key: string): void {
  db.prepare(
    'UPDATE response_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE key = ?',
  ).run(Date.now(), key);
}

/**
 * Purge rows whose created_at is older than `cutoffMs`.
 * Bounded to 500 rows per call to keep transactions short.
 * Returns the number of rows deleted.
 */
export function purgeExpired(db: Database.Database, cutoffMs: number): number {
  const result = db
    .prepare(
      `DELETE FROM response_cache
       WHERE key IN (
         SELECT key FROM response_cache WHERE created_at < ? LIMIT 500
       )`,
    )
    .run(cutoffMs);
  return result.changes;
}

/**
 * Delete all cache entries for a given game_id (used by cache-clear API, phase-08).
 * Returns the number of rows deleted.
 */
export function clearForGame(db: Database.Database, gameId: string): number {
  const result = db.prepare('DELETE FROM response_cache WHERE game_id = ?').run(gameId);
  return result.changes;
}

// ---------------------------------------------------------------------------
// Cached-query search
// ---------------------------------------------------------------------------

export interface CachedQuerySearchHit {
  key: string;
  game_id: string;
  skill: string;
  model: string;
  /** Snippet of the normalized user text (up to 256 chars). */
  user_text_snippet: string;
  hit_count: number;
  cost_usd: number;
  last_hit_at: number | null;
  original_turn_id: string;
  original_session_id: string;
}

export interface CachedQuerySearchParams {
  /** Owner must have at least one live session in the target game. */
  ownerId: string;
  /** LIKE search term (empty string = no filter, returns top rows by hit_count DESC). */
  q: string;
  gameId?: string;
  limit?: number;
}

/**
 * Search response_cache rows for an owner.
 * Owner-scoping: a row is visible only if the owner has at least one chat_session
 * in that game (same defense-in-depth pattern as debug-cache-clear.ts).
 *
 * Matches against `user_text_normalized` with LIKE. Results ordered by hit_count DESC.
 */
export function searchCachedQueries(
  db: Database.Database,
  params: CachedQuerySearchParams,
): CachedQuerySearchHit[] {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

  const conditions: string[] = [
    // Owner must have at least one session in this game
    `EXISTS (
      SELECT 1 FROM chat_sessions cs
      WHERE cs.owner_id = ? AND cs.game_id = rc.game_id AND cs.deleted_at IS NULL
      LIMIT 1
    )`,
  ];
  const bindings: unknown[] = [params.ownerId];

  if (params.gameId) {
    conditions.push('rc.game_id = ?');
    bindings.push(params.gameId);
  }

  if (params.q.trim()) {
    const safe = params.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    conditions.push(`rc.user_text_normalized LIKE ? ESCAPE '\\'`);
    bindings.push(`%${safe}%`);
  }

  bindings.push(limit);

  type RawRow = {
    key: string;
    game_id: string;
    skill: string;
    model: string;
    user_text_normalized: string;
    hit_count: number;
    cost_usd: number;
    last_hit_at: number | null;
    original_turn_id: string;
    original_session_id: string;
  };

  const rows = db
    .prepare(
      `SELECT rc.key, rc.game_id, rc.skill, rc.model,
              rc.user_text_normalized, rc.hit_count, rc.cost_usd, rc.last_hit_at,
              rc.original_turn_id, rc.original_session_id
       FROM response_cache rc
       WHERE ${conditions.join(' AND ')}
       ORDER BY rc.hit_count DESC, rc.created_at DESC
       LIMIT ?`,
    )
    .all(...bindings) as RawRow[];

  return rows.map((row) => ({
    key: row.key,
    game_id: row.game_id,
    skill: row.skill,
    model: row.model,
    user_text_snippet: row.user_text_normalized.slice(0, 256),
    hit_count: row.hit_count,
    cost_usd: row.cost_usd,
    last_hit_at: row.last_hit_at,
    original_turn_id: row.original_turn_id,
    original_session_id: row.original_session_id,
  }));
}
