/**
 * Response cache migration — `response_cache` table + index.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS). Called from migrate.ts after
 * migrateAnnotations. Stores per-game cached LLM responses for exact-match
 * replay without an LLM call.
 *
 * PII note: user_text_normalized is stored here per-game (not per-owner).
 * Pre-ship redaction audit required before enabling in non-dev environments.
 * See phase-06 risk assessment and RESPONSE_CACHE_OWNER_SCOPED env override doc.
 */

import type Database from 'better-sqlite3';

export function migrateResponseCache(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS response_cache (
      key                TEXT    PRIMARY KEY,
      game_id            TEXT    NOT NULL,
      skill              TEXT    NOT NULL,
      model              TEXT    NOT NULL,
      user_text_normalized TEXT  NOT NULL,
      value_json         TEXT    NOT NULL,
      input_tokens       INTEGER NOT NULL,
      output_tokens      INTEGER NOT NULL,
      cost_usd           REAL    NOT NULL,
      hit_count          INTEGER NOT NULL DEFAULT 0,
      created_at         INTEGER NOT NULL,
      last_hit_at        INTEGER,
      original_turn_id   TEXT    NOT NULL,
      original_session_id TEXT   NOT NULL,
      cube_meta_hash     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_response_cache_game_last_hit
      ON response_cache(game_id, last_hit_at);
  `);

  // Idempotent ALTER for existing DBs that were created before cube_meta_hash was added.
  // Legacy rows have cube_meta_hash = NULL → grouped under "legacy" bucket in stale math.
  // better-sqlite3 is single-writer; migrate runs before the HTTP listener accepts requests.
  try {
    db.exec('ALTER TABLE response_cache ADD COLUMN cube_meta_hash TEXT;');
  } catch (err) {
    // SQLite error message for duplicate column is "duplicate column name: ..."
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}
