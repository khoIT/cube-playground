/**
 * One-off ops script: reassign chat sessions from one owner id to another.
 *
 * Why: once chat ownership became server-authoritative (owner = Keycloak sub),
 * sessions created earlier under the placeholder owner `'dev'` no longer match
 * any real user and disappear from every list. This reassigns them to a real
 * owner so they stay visible to that person.
 *
 * Usage (from chat-service/):
 *   tsx src/scripts/reassign-session-owner.ts --to <sub> [options]
 *
 * Options:
 *   --from <owner>     Source owner id to move from.      (default: dev)
 *   --to <sub>         Target owner id (Keycloak sub).    (required)
 *   --label <name>     New owner_label (display name).    (optional)
 *   --game <id>        Restrict to a single game id.      (optional)
 *   --db <path>        SQLite path. (default: CHAT_DB_PATH / ./runtime/chat.db)
 *   --apply            Commit the change. Without it, runs as a dry-run.
 *   --snapshot         After --apply, also rewrite runtime/seed/chat-snapshot.json
 *                      (off by default — it writes a FIXED repo path regardless
 *                      of --db, so only pass it when you mean to refresh the seed).
 *
 * Find your sub: log in, then GET /api/auth/me (or decode the app JWT).
 */

import Database from 'better-sqlite3';
import { migrate } from '../db/migrate.js';
import { writeChatSnapshot } from '../db/snapshot-store.js';
import { config } from '../config.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const fromOwner = arg('from') ?? 'dev';
const toOwner = arg('to');
const label = arg('label');
const game = arg('game');
const dbPath = arg('db') ?? config.chatDbPath;
const apply = has('apply');
const refreshSnapshot = has('snapshot');

if (!toOwner) {
  console.error('Error: --to <sub> is required. See header for usage.');
  process.exit(1);
}
if (toOwner === fromOwner) {
  console.error('Error: --to must differ from --from.');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
migrate(db); // ensure owner_label column exists before we touch it

const where = game ? 'owner_id = ? AND game_id = ?' : 'owner_id = ?';
const whereArgs = game ? [fromOwner, game] : [fromOwner];

const count = (
  db.prepare(`SELECT COUNT(*) AS c FROM chat_sessions WHERE ${where}`).get(...whereArgs) as {
    c: number;
  }
).c;

console.log(
  `[reassign-owner] db=${dbPath} from='${fromOwner}'${game ? ` game='${game}'` : ''} -> to='${toOwner}'` +
    `${label ? ` label='${label}'` : ''} — matched ${count} session(s).`,
);

if (!apply) {
  console.log('[reassign-owner] DRY RUN — re-run with --apply to commit.');
  db.close();
  process.exit(0);
}

// COALESCE keeps existing labels when --label is omitted.
const res = db
  .prepare(
    `UPDATE chat_sessions SET owner_id = ?, owner_label = COALESCE(?, owner_label) WHERE ${where}`,
  )
  .run(toOwner, label ?? null, ...whereArgs);

console.log(`[reassign-owner] updated ${res.changes} session(s).`);

// Snapshot refresh is opt-in: writeChatSnapshot writes a FIXED repo path
// (runtime/seed/chat-snapshot.json), independent of --db, so doing it by
// default would let an arbitrary --db clobber the committed seed.
if (refreshSnapshot) {
  try {
    const path = writeChatSnapshot(db);
    console.log(`[reassign-owner] snapshot refreshed: ${path}`);
  } catch (err) {
    console.warn('[reassign-owner] snapshot write skipped:', (err as Error).message);
  }
}

db.close();
