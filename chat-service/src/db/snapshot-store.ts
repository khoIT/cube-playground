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
  version: 1;
  chat_sessions: Record<string, unknown>[];
  chat_turns: Record<string, unknown>[];
}

/** Path the writeSnapshot CLI uses; also handy for tests. */
export const CHAT_SNAPSHOT_PATH = SNAPSHOT_PATH;

export function writeChatSnapshot(db: Database.Database): string {
  const snap: Snapshot = {
    version: 1,
    chat_sessions: db
      .prepare('SELECT * FROM chat_sessions ORDER BY id')
      .all() as Snapshot['chat_sessions'],
    chat_turns: db
      .prepare('SELECT * FROM chat_turns ORDER BY session_id, turn_index')
      .all() as Snapshot['chat_turns'],
  };

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  return SNAPSHOT_PATH;
}

/**
 * Idempotent hydrate — fills missing rows from the committed snapshot without
 * touching existing ones. Re-running on a fully-synced DB is a no-op.
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

  let sessionsInserted = 0;
  let turnsInserted = 0;
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
  });
  tx();

  return {
    hydrated: sessionsInserted + turnsInserted > 0,
    counts: { sessions: sessionsInserted, turns: turnsInserted },
  };
}
