import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { openDatabase } from '../src/db/migrate.js';
import { hydrateChatFromSnapshot, CHAT_SNAPSHOT_PATH } from '../src/db/snapshot-store.js';

const SNAPSHOT_BAK = `${CHAT_SNAPSHOT_PATH}.test-backup`;

function writeFixture(rows: {
  sessions: Record<string, unknown>[];
  turns: Record<string, unknown>[];
  tombstones?: { session_id: string; deleted_at: number }[];
}) {
  mkdirSync(dirname(CHAT_SNAPSHOT_PATH), { recursive: true });
  writeFileSync(
    CHAT_SNAPSHOT_PATH,
    JSON.stringify(
      {
        version: 2,
        chat_sessions: rows.sessions,
        chat_turns: rows.turns,
        chat_tombstones: rows.tombstones ?? [],
      },
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

  it('applies snapshot tombstones — deletes the local session and records the tombstone', () => {
    // Seed the local DB with a session that was deleted on another machine.
    db.prepare(`
      INSERT INTO chat_sessions (id, owner_id, game_id, title, created_at, status)
      VALUES ('gone', 'khoitn', 'ballistar', 'Total Revenue', 1, 'active')
    `).run();
    db.prepare(`
      INSERT INTO chat_turns (id, session_id, turn_index, role, started_at)
      VALUES ('t1', 'gone', 0, 'user', 1)
    `).run();

    writeFixture({
      sessions: [],
      turns: [],
      tombstones: [{ session_id: 'gone', deleted_at: 1700000000000 }],
    });

    const result = hydrateChatFromSnapshot(db);
    expect(result.hydrated).toBe(true);
    expect(result.counts.tombstones).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM chat_sessions').get()).toEqual({ c: 0 });
    // FK cascade removes the orphaned turn.
    expect(db.prepare('SELECT COUNT(*) AS c FROM chat_turns').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM chat_tombstones').get()).toEqual({ c: 1 });
  });

  it('tombstone applied to an empty DB is a no-op insert but still recorded', () => {
    writeFixture({
      sessions: [],
      turns: [],
      tombstones: [{ session_id: 'never-existed', deleted_at: 1 }],
    });
    const result = hydrateChatFromSnapshot(db);
    expect(result.counts.tombstones).toBe(0); // nothing locally to remove
    expect(db.prepare('SELECT COUNT(*) AS c FROM chat_tombstones').get()).toEqual({ c: 1 });
  });

  it('reads v1 snapshots (no chat_tombstones field) without erroring', () => {
    mkdirSync(dirname(CHAT_SNAPSHOT_PATH), { recursive: true });
    writeFileSync(
      CHAT_SNAPSHOT_PATH,
      JSON.stringify({ version: 1, chat_sessions: [session({ id: 'legacy' })], chat_turns: [] }),
    );
    const result = hydrateChatFromSnapshot(db);
    expect(result.counts.sessions).toBe(1);
    expect(result.counts.tombstones).toBe(0);
  });
});
