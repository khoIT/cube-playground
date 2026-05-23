/**
 * better-sqlite3 singleton.
 * Opens the database, runs all pending migrations (keyed by PRAGMA user_version),
 * and exposes the raw `db` instance for prepared-statement use in routes.
 */

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

// Resolved at startup — either the file path from env or an in-memory DB for tests
const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data', 'segments.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // better-sqlite3 fails if the parent directory is missing
  if (DB_PATH !== ':memory:') {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }

  _db = new Database(DB_PATH);

  // WAL mode for better read concurrency
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  runMigrations(_db);
  return _db;
}

/**
 * Run SQL migration files idempotently.
 * Files are named NNN-description.sql. PRAGMA user_version tracks applied count.
 */
function runMigrations(db: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  const pending = files.slice(currentVersion);
  if (pending.length === 0) return;

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
  }

  db.pragma(`user_version = ${files.length}`);
}

/** Close the DB — used in tests to reset state between suites. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Replace singleton with a provided instance — used in tests for :memory: DBs. */
export function setDb(instance: Database.Database): void {
  _db = instance;
}
