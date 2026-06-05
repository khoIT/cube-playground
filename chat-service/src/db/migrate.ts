/**
 * Idempotent SQLite schema migrator.
 * Reads schema.sql and executes all CREATE TABLE IF NOT EXISTS statements.
 * Safe to call on every boot.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateMonitoring } from './monitoring-migrate.js';
import { migrateObservability } from './observability-migrate.js';
import { migrateAnnotations } from './annotations-migrate.js';
import { migrateResponseCache } from './response-cache-migrate.js';
import { migrateKvCache } from './kv-cache-migrate.js';
import { migrateUserDisambigPrefs } from './user-disambig-prefs-migrate.js';
import { migrateStarterQuestions } from './starter-questions-migrate.js';

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
  // Soft-delete: NULL = not deleted, epoch ms = soft-deleted, pending hard-purge after 7d.
  addColumnIfMissing(db, 'ALTER TABLE chat_sessions ADD COLUMN deleted_at INTEGER;');
  // Phase-01: Anthropic SDK conversation id; null = no resume payload available.
  // Cleared on compaction so the post-compact session opens a fresh SDK thread.
  addColumnIfMissing(db, 'ALTER TABLE chat_sessions ADD COLUMN sdk_conversation_id TEXT;');
  // Cube data workspace ("local" mints JWTs against local Cube; "prod" hits
  // the open prod cube-dev). Sessions are partitioned per workspace so
  // switching workspaces in the playground hides sessions whose cube refs
  // belong to a different namespace (prefixed prod vs flat local).
  addColumnIfMissing(db, "ALTER TABLE chat_sessions ADD COLUMN workspace TEXT NOT NULL DEFAULT 'local';");
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_owner_workspace_game
       ON chat_sessions(owner_id, workspace, game_id, last_turn_at DESC);`,
  );
  // Publish-to-team: a session may be marked 'shared' so other authenticated
  // members get a read-only view; 'private' (default) stays owner-only.
  addColumnIfMissing(db, "ALTER TABLE chat_sessions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';");
  // Owner display name stamped at creation so shared lists show "shared by …"
  // without a cross-service identity lookup.
  addColumnIfMissing(db, 'ALTER TABLE chat_sessions ADD COLUMN owner_label TEXT;');
  // Epoch ms the session was last shared; NULL when private.
  addColumnIfMissing(db, 'ALTER TABLE chat_sessions ADD COLUMN shared_at INTEGER;');
  // Index for the cross-owner "shared with team" listing per game/workspace.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_shared
       ON chat_sessions(visibility, game_id, workspace, last_turn_at DESC);`,
  );
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN charts_json TEXT;');

  // Observability columns added to chat_turns for per-turn metadata capture.
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN system_prompt_text TEXT;');
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN model TEXT;');
  // Phase-02: turn-level stop_reason captured from SDK result message.
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN stop_reason TEXT;');
  // Phase-03: cache token breakdown from Anthropic SDK result usage block.
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN cache_creation_tokens INTEGER;');
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN cache_read_tokens INTEGER;');
  // Phase-06: response-cache columns on chat_turns.
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN cache_hit INTEGER DEFAULT 0;');
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN original_turn_id TEXT;');
  // Freshness flag on cache-hit turns: 'refreshed' (chart data re-executed live)
  // or 'stale' (served from cache without re-execute). NULL on non-cache-hit turns.
  addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN cache_freshness TEXT;');

  // Phase-driven migrations run in a fixed order per decision C1. Each helper
  // is idempotent and safe to re-run.
  migrateMonitoring(db);
  migrateObservability(db);
  migrateAnnotations(db);
  migrateResponseCache(db);
  migrateKvCache(db);
  migrateUserDisambigPrefs(db);
  migrateStarterQuestions(db);
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
