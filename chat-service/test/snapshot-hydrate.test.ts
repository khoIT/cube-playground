import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { openDatabase } from '../src/db/migrate.js';
import { hydrateChatFromSnapshot, CHAT_SNAPSHOT_PATH } from '../src/db/snapshot-store.js';

const SNAPSHOT_BAK = `${CHAT_SNAPSHOT_PATH}.test-backup`;

function writeFixture(rows: { sessions: Record<string, unknown>[]; turns: Record<string, unknown>[] }) {
  mkdirSync(dirname(CHAT_SNAPSHOT_PATH), { recursive: true });
  writeFileSync(
    CHAT_SNAPSHOT_PATH,
    JSON.stringify(
      { version: 1, chat_sessions: rows.sessions, chat_turns: rows.turns },
      null,
      2,
    ),
  );
}

function session(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sess-a',
    owner_id: 'khoitn',
    game_id: 'ballistar',
    title: 'Test',
    created_at: 1700000000000,
    last_turn_at: null,
    turn_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    status: 'active',
    parent_session_id: null,
    compacted_into: null,
    ...overrides,
  };
}

describe('hydrateChatFromSnapshot', () => {
  let db: Database.Database;

  beforeEach(() => {
    if (existsSync(CHAT_SNAPSHOT_PATH)) {
      writeFileSync(SNAPSHOT_BAK, readFileSync(CHAT_SNAPSHOT_PATH));
    }
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
    if (existsSync(SNAPSHOT_BAK)) {
      writeFileSync(CHAT_SNAPSHOT_PATH, readFileSync(SNAPSHOT_BAK));
      rmSync(SNAPSHOT_BAK);
    }
  });

  it('inserts every snapshot session into an empty DB', () => {
    writeFixture({
      sessions: [session({ id: 'a' }), session({ id: 'b' })],
      turns: [],
    });
    const result = hydrateChatFromSnapshot(db);
    expect(result.hydrated).toBe(true);
    expect(result.counts.sessions).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS c FROM chat_sessions').get()).toEqual({ c: 2 });
  });

  it('preserves locally-edited sessions (idempotent backfill)', () => {
    db.prepare(`
      INSERT INTO chat_sessions (id, owner_id, game_id, title, created_at, status)
      VALUES ('a', 'khoitn', 'ballistar', 'LOCAL EDIT', 1, 'active')
    `).run();
    writeFixture({
      sessions: [session({ id: 'a', title: 'snapshot version' }), session({ id: 'b' })],
      turns: [],
    });
    const result = hydrateChatFromSnapshot(db);
    expect(result.counts.sessions).toBe(1);
    const rows = db.prepare('SELECT id, title FROM chat_sessions ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'a', title: 'LOCAL EDIT' },
      { id: 'b', title: 'Test' },
    ]);
  });

  it('reports hydrated=false when the DB is already in sync', () => {
    writeFixture({ sessions: [session({ id: 'a' })], turns: [] });
    hydrateChatFromSnapshot(db);
    const second = hydrateChatFromSnapshot(db);
    expect(second.hydrated).toBe(false);
    expect(second.counts.sessions).toBe(0);
  });
});
