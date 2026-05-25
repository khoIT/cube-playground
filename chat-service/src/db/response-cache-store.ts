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
        original_turn_id, original_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
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
