/**
 * Snapshot of the chat workspace (sessions + turns) as a single JSON file
 * checked into git. Mirrors the segments-snapshot system in `server/`:
 *
 *   1. dev creates sessions/turns → chat.db is populated
 *   2. `npm run snapshot` dumps DB → runtime/seed/chat-snapshot.json
 *   3. dev commits the JSON
 *   4. another machine clones, starts chat-service with an empty DB
 *   5. boot hydrate fills any missing rows (INSERT OR IGNORE by primary key)
 *      so a fresh `git pull` lands with the same conversation history.
 *
 * `chat_audit` is intentionally excluded — it's append-only local
 * observability with an autoincrement id that would collide across machines.
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, '..', '..', 'runtime', 'seed', 'chat-snapshot.json');

interface Snapshot {
  /** v1: sessions + turns only. v2: adds chat_tombstones so deletions propagate. */
  version: 1 | 2;
  chat_sessions: Record<string, unknown>[];
  chat_turns: Record<string, unknown>[];
  /** Optional for v1 backwards compat; always written for v2. */
  chat_tombstones?: { session_id: string; deleted_at: number }[];
}

/** Path the writeSnapshot CLI uses; also handy for tests. */
export const CHAT_SNAPSHOT_PATH = SNAPSHOT_PATH;

/**
 * Boot-time diagnostic — compares local chat counts to the committed
 * snapshot. Used by index.ts to log sync status next to "chat-service
 * listening".
 */
export function getChatSyncStatus(db: Database.Database): {
  sessions: { local: number; snapshot: number; ok: boolean };
  turns: { local: number; snapshot: number; ok: boolean };
  tombstones: { local: number; snapshot: number; ok: boolean };
} | null {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  const snap: Snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const sessionsSnap = snap.chat_sessions.length;
  const turnsSnap = snap.chat_turns.length;
  const tombstonesSnap = snap.chat_tombstones?.length ?? 0;
  const sessionsLocal = (db.prepare('SELECT COUNT(*) AS c FROM chat_sessions').get() as { c: number }).c;
  const turnsLocal = (db.prepare('SELECT COUNT(*) AS c FROM chat_turns').get() as { c: number }).c;
  const tombstonesLocal = (db.prepare('SELECT COUNT(*) AS c FROM chat_tombstones').get() as { c: number }).c;
  return {
    sessions: { local: sessionsLocal, snapshot: sessionsSnap, ok: sessionsLocal >= sessionsSnap },
    turns: { local: turnsLocal, snapshot: turnsSnap, ok: turnsLocal >= turnsSnap },
    tombstones: { local: tombstonesLocal, snapshot: tombstonesSnap, ok: tombstonesLocal >= tombstonesSnap },
  };
}

export function writeChatSnapshot(db: Database.Database): string {
  const snap: Snapshot = {
    version: 2,
    chat_sessions: db
      .prepare('SELECT * FROM chat_sessions ORDER BY id')
      .all() as Snapshot['chat_sessions'],
    chat_turns: db
      .prepare('SELECT * FROM chat_turns ORDER BY session_id, turn_index')
      .all() as Snapshot['chat_turns'],
    chat_tombstones: db
      .prepare('SELECT session_id, deleted_at FROM chat_tombstones ORDER BY session_id')
      .all() as Snapshot['chat_tombstones'],
  };

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  return SNAPSHOT_PATH;
}

/**
 * Idempotent hydrate — fills missing rows from the committed snapshot without
 * touching existing edits, then applies any tombstones so deletions made on
 * other machines reconcile here. Re-running on a fully-synced DB is a no-op.
 *
 * Tombstone semantics: a snapshot tombstone is authoritative — even if the
 * local DB has a matching session (perhaps re-created with the same id, which
 * is vanishingly unlikely with UUIDs), the tombstone wins. The session row
 * (and its turns, via FK cascade) is removed and the tombstone is recorded
 * locally so it propagates onward in the next snapshot.
 */
export function hydrateChatFromSnapshot(db: Database.Database): {
  hydrated: boolean;
  counts: Record<string, number>;
} {
  if (!existsSync(SNAPSHOT_PATH)) return { hydrated: false, counts: {} };

  const snap: Snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO chat_sessions
      (id, owner_id, game_id, title, created_at, last_turn_at, turn_count,
       total_input_tokens, total_output_tokens, status, parent_session_id, compacted_into)
    VALUES (@id, @owner_id, @game_id, @title, @created_at, @last_turn_at, @turn_count,
            @total_input_tokens, @total_output_tokens, @status, @parent_session_id, @compacted_into)
  `);
  const insertTurn = db.prepare(`
    INSERT OR IGNORE INTO chat_turns
      (id, session_id, turn_index, role, user_text, assistant_text, reasoning_json,
       tool_calls_json, artifacts_json, charts_json, input_tokens, output_tokens,
       cost_usd, skill, started_at, ended_at)
    VALUES (@id, @session_id, @turn_index, @role, @user_text, @assistant_text, @reasoning_json,
            @tool_calls_json, @artifacts_json, @charts_json, @input_tokens, @output_tokens,
            @cost_usd, @skill, @started_at, @ended_at)
  `);
  const upsertTombstone = db.prepare(
    'INSERT OR REPLACE INTO chat_tombstones (session_id, deleted_at) VALUES (?, ?)',
  );
  const deleteSession = db.prepare('DELETE FROM chat_sessions WHERE id = ?');

  let sessionsInserted = 0;
  let turnsInserted = 0;
  let tombstonesApplied = 0;
  const tx = db.transaction(() => {
    for (const s of snap.chat_sessions) {
      // Backfill columns that may be missing from snapshots taken before later
      // ALTER TABLE migrations (parent_session_id, compacted_into, charts_json).
      sessionsInserted += insertSession.run({
        parent_session_id: null,
        compacted_into: null,
        ...s,
      }).changes;
    }
    for (const t of snap.chat_turns) {
      turnsInserted += insertTurn.run({
        charts_json: null,
        ...t,
      }).changes;
    }
    // Tombstones run last so they win against any insert above for the same id.
    for (const tomb of snap.chat_tombstones ?? []) {
      upsertTombstone.run(tomb.session_id, tomb.deleted_at);
      const removed = deleteSession.run(tomb.session_id).changes;
      tombstonesApplied += removed;
    }
  });
  tx();

  return {
    hydrated: sessionsInserted + turnsInserted + tombstonesApplied > 0,
    counts: { sessions: sessionsInserted, turns: turnsInserted, tombstones: tombstonesApplied },
  };
}
