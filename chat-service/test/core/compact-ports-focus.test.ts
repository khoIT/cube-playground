/**
 * Phase 02 — compactSession ports the focus bag to the new session.
 *
 * SDK resume id is intentionally cleared on compact (phase 01 — old thread
 * is summarised, not replayed). Focus is the opposite: a deterministic
 * carry-over so the model still sees "last metric / dimension / timeRange"
 * after the thread reset.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';
import { compactSession } from '../../src/core/compact-service.js';
import { mergeFocus, getFocus } from '../../src/cache/session-focus-adapter.js';
import { config } from '../../src/config.js';

const OWNER = 'o1';

beforeEach(() => {
  (config as { cacheServiceEnabled: boolean; chatContextFocusStoreEnabled: boolean })
    .cacheServiceEnabled = true;
  (config as { cacheServiceEnabled: boolean; chatContextFocusStoreEnabled: boolean })
    .chatContextFocusStoreEnabled = true;
});

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('compactSession — focus port', () => {
  it('copies focus from old session to new session before sealing', async () => {
    const db = makeDb();
    const old = chatStore.createSession(db, { ownerId: OWNER, gameId: 'ptg' });

    // Seed turns so summariserFn has content.
    chatStore.appendTurn(db, {
      sessionId: old.id, turnIndex: 0, role: 'user',
      userText: 'hi', startedAt: Date.now(), endedAt: Date.now(),
    });
    chatStore.appendTurn(db, {
      sessionId: old.id, turnIndex: 1, role: 'assistant',
      assistantText: 'hello', startedAt: Date.now(), endedAt: Date.now(),
    });

    // Seed focus on the old session.
    mergeFocus(db, old.id, OWNER, {
      metric: { value: 'recharge.revenue_vnd', phrase: 'revenue' },
      timeRange: {
        value: { dateRange: 'last 7 days', granularity: 'day' },
        phrase: 'last 7 days',
      },
      artifactRef: { value: 'artifact:xyz' },
    });

    const result = await compactSession({
      sessionId: old.id,
      db,
      summariserFn: async () => 'short summary',
    });

    // Old session is compacted but focus row may or may not still exist —
    // contract is "ported to new session", not "cleared from old". Verify
    // the new session sees the focus.
    const newFocus = getFocus(db, result.newSessionId);
    expect(newFocus.metric?.value).toBe('recharge.revenue_vnd');
    expect(newFocus.timeRange?.value.dateRange).toBe('last 7 days');
    expect(newFocus.artifactRef?.value).toBe('artifact:xyz');
  });

  it('no-op when old session has no focus', async () => {
    const db = makeDb();
    const old = chatStore.createSession(db, { ownerId: OWNER, gameId: 'ptg' });
    chatStore.appendTurn(db, {
      sessionId: old.id, turnIndex: 0, role: 'user',
      userText: 'hi', startedAt: Date.now(), endedAt: Date.now(),
    });
    chatStore.appendTurn(db, {
      sessionId: old.id, turnIndex: 1, role: 'assistant',
      assistantText: 'hello', startedAt: Date.now(), endedAt: Date.now(),
    });

    const result = await compactSession({
      sessionId: old.id,
      db,
      summariserFn: async () => 'sum',
    });

    // New session focus is empty; no crash.
    expect(getFocus(db, result.newSessionId)).toEqual({});
  });
});
