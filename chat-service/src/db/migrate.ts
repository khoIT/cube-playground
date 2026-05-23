/**
 * Idempotent SQLite schema migrator.
 * Reads schema.sql and executes all CREATE TABLE IF NOT EXISTS statements.
 * Safe to call on every boot.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Run a single ALTER TABLE statement, silently ignoring "duplicate column" errors. */
function addColumnIfMissing(db: Database.Database, stmt: string): void {
  try {
    db.exec(stmt);
  } catch (err) {
    // better-sqlite3 throws when the column already exists; we ignore that error.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('duplicate column name')) throw err;
  }
}

export function migrate(db: Database.Database): void {
  const schemaPath = resolve(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf-8');
  db.exec(sql);

  // Idempotent column additions for databases created before these columns existed.
  addColumnIfMissing(db, 'ALTER TABLE chat_sessions ADD COLUMN parent_session_id TEXT;');
  addColumnIfMissing(db, 'ALTER TABLE chat_sessions ADD COLUMN compacted_into TEXT;');
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN charts_json TEXT;');
}

/**
 * Open (or create) the SQLite database at the given path and run migrations.
 * Returns the open Database instance.
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  // WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
