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
 *
 * Files are named NNN-description.sql and applied in sorted-filename order.
 * PRAGMA user_version holds the COUNT of files already applied, so each boot runs
 * files.slice(user_version).
 *
 * INVARIANT — never back-fill a numbering gap. The directory has permanent gaps
 * (e.g. 044/045/047/070 were never created). Ordering is by sorted filename, not
 * the numeric prefix, and the cursor is a count — so adding a lower-numbered file
 * later shifts every subsequent file's slice position and silently re-runs
 * already-applied migrations. SQLite ADD COLUMN has no IF NOT EXISTS, so that
 * surfaces as a "duplicate column" wedge on boot. Always append the next free
 * number above the highest existing file.
 *
 * Each file is applied in its own transaction, and user_version is advanced WITHIN
 * that same transaction. A mid-file failure (e.g. the 2nd ALTER of a multi-ALTER
 * file) rolls the whole file back and leaves user_version pointing at the last
 * fully-applied file, so the next boot resumes exactly at the failed file — no
 * half-applied DDL, no duplicate-column wedge.
 *
 * Manual recovery if a file is genuinely broken: read `PRAGMA user_version`, undo
 * any partial DDL by hand, fix the file, and set user_version back to the count of
 * fully-applied files so the failed file re-runs cleanly.
 */
function runMigrations(db: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  const pending = files.slice(currentVersion);
  if (pending.length === 0) return;

  let applied = currentVersion;
  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const nextVersion = applied + 1;
    const runFile = db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${nextVersion}`);
    });
    runFile();
    applied = nextVersion;
  }
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
