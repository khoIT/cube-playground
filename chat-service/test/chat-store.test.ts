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

    it('lists a just-created session (NULL last_turn_at) first, even past LIMIT of older sessions', () => {
      // 20 older sessions with completed turns (last_turn_at set). Backdate
      // them 1 min so timestamps can't tie with the fresh session below.
      for (let i = 0; i < 20; i++) {
        const s = chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg', title: `old ${i}` });
        chatStore.incrementTurnCount(db, s.id, 10, 10);
        db.prepare('UPDATE chat_sessions SET created_at = ?, last_turn_at = ? WHERE id = ?')
          .run(Date.now() - 60_000, Date.now() - 60_000, s.id);
      }
      // Fresh session whose first turn hasn't completed yet — last_turn_at NULL.
      const fresh = chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg', title: 'fresh' });
      expect(chatStore.getSession(db, fresh.id)!.last_turn_at).toBeNull();

      const list = chatStore.listSessions(db, { ownerId: 'owner1', gameId: 'ptg', limit: 20 });
      expect(list).toHaveLength(20);
      // Plain ORDER BY last_turn_at DESC sorted NULL last → cut off by LIMIT.
      expect(list[0].id).toBe(fresh.id);
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

    it('softDeleteSession sets deleted_at without cascading turns', () => {
      const session = chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg' });
      chatStore.appendTurn(db, {
        sessionId: session.id, turnIndex: 0, role: 'user',
        userText: 'hi', startedAt: Date.now(),
      });

      const before = Date.now();
      chatStore.softDeleteSession(db, session.id);
      const after = Date.now();

      const row = chatStore.getSession(db, session.id);
      expect(row).not.toBeNull();
      expect(row!.deleted_at).toBeGreaterThanOrEqual(before);
      expect(row!.deleted_at).toBeLessThanOrEqual(after);

      // Turns must still exist (no cascade fired on soft-delete)
      const turns = chatStore.listTurns(db, session.id);
      expect(turns).toHaveLength(1);

      // No tombstone written at soft-delete time
      const tombstone = db
        .prepare('SELECT session_id FROM chat_tombstones WHERE session_id = ?')
        .get(session.id);
      expect(tombstone).toBeUndefined();
    });

    it('listSessions hides soft-deleted sessions', () => {
      const s1 = chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg' });
      chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg' });
      chatStore.softDeleteSession(db, s1.id);

      const list = chatStore.listSessions(db, { ownerId: 'owner1', gameId: 'ptg' });
      expect(list).toHaveLength(1);
      expect(list[0].id).not.toBe(s1.id);
    });

    it('getSession returns soft-deleted session (admin/debug path, no filter)', () => {
      const session = chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg' });
      chatStore.softDeleteSession(db, session.id);

      const row = chatStore.getSession(db, session.id);
      expect(row).not.toBeNull();
      expect(row!.deleted_at).not.toBeNull();
    });

    it('restoreSession clears deleted_at and session reappears in listSessions', () => {
      const session = chatStore.createSession(db, { ownerId: 'owner1', gameId: 'ptg' });
      chatStore.softDeleteSession(db, session.id);
      chatStore.restoreSession(db, session.id);

      const row = chatStore.getSession(db, session.id);
      expect(row!.deleted_at).toBeNull();

      const list = chatStore.listSessions(db, { ownerId: 'owner1', gameId: 'ptg' });
      expect(list.some((s) => s.id === session.id)).toBe(true);
    });

    it('purgeSoftDeleted hard-deletes sessions older than cutoff and writes tombstones', () => {
      const old = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      const recent = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });

      const now = Date.now();
      const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
      const sixDaysAgo = now - 6 * 24 * 60 * 60 * 1000;

      // Directly set deleted_at timestamps to bypass the 7d boundary.
      db.prepare('UPDATE chat_sessions SET deleted_at = ? WHERE id = ?').run(eightDaysAgo, old.id);
      db.prepare('UPDATE chat_sessions SET deleted_at = ? WHERE id = ?').run(sixDaysAgo, recent.id);

      const cutoff = now - 7 * 24 * 60 * 60 * 1000;
      const purged = chatStore.purgeSoftDeleted(db, cutoff);

      expect(purged).toBe(1);
      expect(chatStore.getSession(db, old.id)).toBeNull(); // hard-deleted
      expect(chatStore.getSession(db, recent.id)).not.toBeNull(); // kept

      const tombstone = db
        .prepare('SELECT session_id FROM chat_tombstones WHERE session_id = ?')
        .get(old.id) as { session_id: string } | undefined;
      expect(tombstone?.session_id).toBe(old.id);
    });

    it('purgeSoftDeleted is idempotent — second call on empty set returns 0', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      db.prepare('UPDATE chat_sessions SET deleted_at = ? WHERE id = ?').run(eightDaysAgo, session.id);

      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      chatStore.purgeSoftDeleted(db, cutoff);
      const second = chatStore.purgeSoftDeleted(db, cutoff);
      expect(second).toBe(0);
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
    it('uses caller-supplied id when provided (FK-link for observability)', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      const myId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      chatStore.appendTurn(db, {
        id: myId,
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        assistantText: 'ok',
        startedAt: Date.now(),
        endedAt: Date.now(),
      });

      const turns = chatStore.listTurns(db, session.id);
      expect(turns).toHaveLength(1);
      expect(turns[0].id).toBe(myId);
    });

    it('round-trips reasoningJson on the assistant row', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      const reasoning = 'thought A...\nthought B...';
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        assistantText: 'final answer',
        reasoningJson: reasoning,
        startedAt: Date.now(),
        endedAt: Date.now(),
      });
      const turns = chatStore.listTurns(db, session.id);
      expect(turns[0].reasoning_json).toBe(reasoning);
    });

    it('round-trips disambigJson on the assistant row (choice chips survive reload)', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      const disambig = JSON.stringify({
        slot: 'choice',
        prompt: 'Pick a direction',
        options: [
          { label: 'Revenue trend', pinText: 'Show daily revenue last 90 days.' },
          { label: 'IAP vs Web', pinText: 'Compare IAP vs Web revenue last 30 days.' },
        ],
      });
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        assistantText: 'Which direction?',
        disambigJson: disambig,
        startedAt: Date.now(),
        endedAt: Date.now(),
      });
      const turns = chatStore.listTurns(db, session.id);
      expect(turns[0].disambig_json).toBe(disambig);
      expect(JSON.parse(turns[0].disambig_json!).options).toHaveLength(2);
    });

    it('leaves disambig_json NULL when no choices were offered', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        assistantText: 'plain answer',
        startedAt: Date.now(),
        endedAt: Date.now(),
      });
      expect(chatStore.listTurns(db, session.id)[0].disambig_json).toBeNull();
    });

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

    // Phase-03: cache token columns
    it('persists cache_creation_tokens and cache_read_tokens on assistant turn', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        assistantText: 'cached response',
        inputTokens: 1000,
        outputTokens: 200,
        cacheCreationTokens: 800,
        cacheReadTokens: 600,
        startedAt: Date.now(),
        endedAt: Date.now(),
      });

      const turns = chatStore.listTurns(db, session.id);
      expect(turns[0].cache_creation_tokens).toBe(800);
      expect(turns[0].cache_read_tokens).toBe(600);
    });

    it('stores null for cache columns when not provided', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        assistantText: 'no cache',
        inputTokens: 500,
        outputTokens: 100,
        startedAt: Date.now(),
      });

      const turns = chatStore.listTurns(db, session.id);
      expect(turns[0].cache_creation_tokens).toBeNull();
      expect(turns[0].cache_read_tokens).toBeNull();
    });

    it('stores zero cache tokens explicitly (non-caching model response)', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        assistantText: 'zero cache',
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        startedAt: Date.now(),
      });

      const turns = chatStore.listTurns(db, session.id);
      expect(turns[0].cache_creation_tokens).toBe(0);
      expect(turns[0].cache_read_tokens).toBe(0);
    });

    it('queryStats round-trip: cache columns do not break aggregate query', () => {
      const session = chatStore.createSession(db, { ownerId: 'o', gameId: 'g' });
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: 0,
        role: 'assistant',
        inputTokens: 1000,
        outputTokens: 300,
        cacheCreationTokens: 500,
        cacheReadTokens: 200,
        skill: 'explore',
        startedAt: Date.now(),
        endedAt: Date.now(),
      });

      const stats = chatStore.queryStats(db, {
        ownerId: 'o',
        fromMs: 0,
        toMs: Date.now() + 1000,
      });
      expect(stats.turns).toBe(1);
      expect(stats.input_tokens).toBe(1000);
      expect(stats.output_tokens).toBe(300);
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
