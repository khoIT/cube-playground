/**
 * Starter-question sets migration — `starter_question_sets` table.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS). Called from migrate.ts after
 * migrateUserDisambigPrefs. One row per (workspace, game_id) holding the
 * current best pre-generated starter-question set for the chat landing page:
 * a deterministic template baseline first, replaced by an LLM-refined set
 * once the async refine pass settles.
 *
 * No owner/PII stored — questions are schema-derived, not user data.
 */

import type Database from 'better-sqlite3';

export function migrateStarterQuestions(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS starter_question_sets (
      workspace       TEXT    NOT NULL,
      game_id         TEXT    NOT NULL,
      meta_hash       TEXT    NOT NULL,
      source          TEXT    NOT NULL,
      questions_json  TEXT    NOT NULL,
      status          TEXT    NOT NULL,
      inflight_until  INTEGER,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (workspace, game_id)
    );
  `);
}
