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

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

export function resolveDbPath(): string {
  // Read process.env.DB_PATH at first getDb() rather than at module load. ES
  // modules hoist imports, so test files that assign `process.env.DB_PATH = …`
  // at top level would otherwise lose the race — the singleton would open the
  // real dev DB and a later DELETE in the test wipes shared state.
  if (_dbPath !== null) return _dbPath;
  // Fallback anchors to the server package root (two levels above this file:
  // src/db or dist/db → server/) instead of process.cwd(). A cwd-relative
  // fallback meant any process importing this module from an arbitrary
  // working directory silently scaffolded a fresh data/segments.db there —
  // full migrations and all. Prod always sets DB_PATH explicitly, so this
  // only pins the dev/test default to server/data/segments.db.
  _dbPath = process.env.DB_PATH ?? join(__dirname, '..', '..', 'data', 'segments.db');
  return _dbPath;
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = resolveDbPath();

  // better-sqlite3 fails if the parent directory is missing
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  _db = new Database(dbPath);

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
  _dbPath = null;
}

/** Replace singleton with a provided instance — used in tests for :memory: DBs. */
export function setDb(instance: Database.Database): void {
  _db = instance;
}
