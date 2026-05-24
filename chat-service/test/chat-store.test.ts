/**
 * chat-store CRUD tests using in-memory SQLite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';
import * as chatStore from '../src/db/chat-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('chatStore', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  describe('sessions', () => {
    it('creates and retrieves a session', () => {
      const session = chatStore.createSession(db, {
        ownerId: 'owner1',
        gameId: 'ptg',
        title: 'Test session',
      });
      expect(session.id).toBeTruthy();
      expect(session.owner_id).toBe('owner1');
      expect(session.game_id).toBe('ptg');
      expect(session.status).toBe('active');

      const fetched = chatStore.getSession(db, session.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(session.id);
    });

    it('returns null for unknown session id', () => {
      expect(chatStore.getSession(db, 'nonexistent')).toBeNull();
    });

    it('lists sessions filtered by owner + game', () => {
      chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg' });
      chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg' });
      chatStore.createSession(db, { ownerId: 'owner2', gameId: 'ptg' });
      chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ballistar' });

      const list = chatStore.listSessions(db, { ownerId: 'owner1', gameId: 'ptg' });
      expect(list).toHaveLength(2);
      expect(list.every((s) => s.owner_id === 'owner1' && s.game_id === 'ptg')).toBe(true);
    });

    it('deletes a session — gone from listSessions, getSession, and records a tombstone', () => {
      const session = chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg' });
      chatStore.deleteSession(db, session.id);

      const list = chatStore.listSessions(db, { ownerId: 'owner1', gameId: 'ptg' });
      expect(list).toHaveLength(0);

      expect(chatStore.getSession(db, session.id)).toBeNull();

      const tombstone = db
        .prepare('SELECT session_id FROM chat_tombstones WHERE session_id = ?')
        .get(session.id) as { session_id: string } | undefined;
      expect(tombstone?.session_id).toBe(session.id);
    });

    it('incrementTurnCount updates counters and last_turn_at', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      chatStore.incrementTurnCount(db, session.id, 100, 200);

      const updated = chatStore.getSession(db, session.id)!;
      expect(updated.turn_count).toBe(1);
      expect(updated.total_input_tokens).toBe(100);
      expect(updated.total_output_tokens).toBe(200);
      expect(updated.last_turn_at).toBeGreaterThan(0);
    });
  });

  describe('turns', () => {
    it('appends and lists turns in order', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });

      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'user',
        userText: 'hello',
        startedAt: Date.now(),
      });

      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 1,
        role: 'assistant',
        assistantText: 'hi there',
        inputTokens: 10,
        outputTokens: 20,
        startedAt: Date.now(),
        endedAt: Date.now(),
      });

      const turns = chatStore.listTurns(db, session.id);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe('user');
      expect(turns[0].user_text).toBe('hello');
      expect(turns[1].role).toBe('assistant');
      expect(turns[1].assistant_text).toBe('hi there');
      expect(turns[1].output_tokens).toBe(20);
    });

    it('serialises artifacts_json correctly', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      const artifact = {
        id: 'art1',
        title: 'Revenue',
        summary: 'Daily revenue',
        game: 'ptg',
        query: { measures: ['Revenue.total'] },
        source: 'raw' as const,
        deeplinkUrl: '#/build?query=...',
        deeplinkVia: 'inline' as const,
      };

      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        artifacts: [artifact],
        startedAt: Date.now(),
      });

      const turns = chatStore.listTurns(db, session.id);
      const parsed = JSON.parse(turns[0].artifacts_json!);
      expect(parsed[0].id).toBe('art1');
    });

    it('serialises charts_json round-trip', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      const chart = {
        id: 'chart-1',
        truncated: false,
        originalRowCount: 2,
        spec: {
          type: 'bar' as const,
          title: 'Sales by region',
          data: [
            { region: 'NA', revenue: 100 },
            { region: 'EU', revenue: 80 },
          ],
          encoding: { category: 'region', value: 'revenue' },
        },
      };

      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        charts: [chart],
        startedAt: Date.now(),
      });

      const turns = chatStore.listTurns(db, session.id);
      expect(turns[0].charts_json).toBeTruthy();
      const parsed = JSON.parse(turns[0].charts_json!);
      expect(parsed[0].id).toBe('chart-1');
      expect(parsed[0].spec.type).toBe('bar');
      expect(parsed[0].spec.data).toHaveLength(2);
    });

    it('charts_json is null when no charts provided', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'user',
        userText: 'hi',
        startedAt: Date.now(),
      });
      const turns = chatStore.listTurns(db, session.id);
      expect(turns[0].charts_json).toBeNull();
    });
  });

  describe('index coverage', () => {
    it('EXPLAIN QUERY PLAN uses idx_sessions_owner_game for listSessions', () => {
      // Confirm the index is hit for the owner+game query
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM chat_sessions
           WHERE owner_id = ? AND game_id = ? AND status != 'archived'
           ORDER BY last_turn_at DESC, created_at DESC
           LIMIT ?`,
        )
        .all('o', 'g', 20) as Array<{ detail: string }>;

      const usesIndex = plan.some(
        (row) => row.detail?.toLowerCase().includes('idx_sessions_owner_game'),
      );
      expect(usesIndex).toBe(true);
    });

    it('EXPLAIN QUERY PLAN uses idx_turns_session_index for listTurns', () => {
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM chat_turns
           WHERE session_id = ?
           ORDER BY turn_index ASC`,
        )
        .all('some-id') as Array<{ detail: string }>;

      const usesIndex = plan.some(
        (row) => row.detail?.toLowerCase().includes('idx_turns_session_index'),
      );
      expect(usesIndex).toBe(true);
    });
  });
});
