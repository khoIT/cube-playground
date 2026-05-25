/**
 * Annotation migration — `turn_annotations` table.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).
 * Called from migrate.ts after migrateObservability.
 *
 * One row per (turn_id) — INSERT OR REPLACE semantics for upsert.
 * Cascades on turn delete so hard-purge of sessions auto-purges annotations.
 */

import type Database from 'better-sqlite3';

export function migrateAnnotations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_annotations (
      turn_id   TEXT    PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
      owner_id  TEXT    NOT NULL,
      starred   INTEGER NOT NULL DEFAULT 0,
      flag      TEXT,
      note      TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_turn_annotations_owner_starred
      ON turn_annotations(owner_id, starred);
  `);
}
