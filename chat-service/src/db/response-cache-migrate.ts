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
      original_session_id TEXT   NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_response_cache_game_last_hit
      ON response_cache(game_id, last_hit_at);
  `);
}
