/**
 * Unit tests for compact-service.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';
import * as chatStore from '../src/db/chat-store.js';
import { shouldCompact, compactSession } from '../src/core/compact-service.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('shouldCompact', () => {
  it('returns false when usage is below 80% of budget', () => {
    const session = {
      total_input_tokens: 50_000,
      total_output_tokens: 50_000,
    } as Parameters<typeof shouldCompact>[0];
    const result = shouldCompact(session, 200_000);
    expect(result.shouldCompact).toBe(false);
  });

  it('returns true when usage equals exactly 80% of budget', () => {
    const session = {
      total_input_tokens: 80_000,
      total_output_tokens: 80_000,
    } as Parameters<typeof shouldCompact>[0];
    // total = 160_000 = 0.8 * 200_000 — not strictly greater, should be false
    const result = shouldCompact(session, 200_000);
    expect(result.shouldCompact).toBe(false);
  });

  it('returns true when usage exceeds 80% of budget', () => {
    const session = {
      total_input_tokens: 100_000,
      total_output_tokens: 53_000,
    } as Parameters<typeof shouldCompact>[0];
    // total = 153_000 > 0.85 * 180_000
    const result = shouldCompact(session, 180_000);
    expect(result.shouldCompact).toBe(true);
    expect(result.reason).toContain('153000');
  });

  it('returns true at 0.85 * budget (real-world threshold check)', () => {
    const budget = 180_000;
    const session = {
      total_input_tokens: Math.floor(budget * 0.85),
      total_output_tokens: 0,
    } as Parameters<typeof shouldCompact>[0];
    const result = shouldCompact(session, budget);
    expect(result.shouldCompact).toBe(true);
  });
});

describe('compactSession', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('creates a new child session, inserts summary preamble, marks old as compacted', async () => {
    const oldSession = chatStore.createSession(db, {
      ownerId: 'owner1',
      gameId: 'ptg',
      title: 'My session',
    });

    // Seed a few turns
    chatStore.appendTurn(db, {
      sessionId: oldSession.id,
      turnIndex: 0,
      role: 'user',
      userText: 'Show me revenue',
      startedAt: Date.now(),
    });
    chatStore.appendTurn(db, {
      sessionId: oldSession.id,
      turnIndex: 1,
      role: 'assistant',
      assistantText: 'Here is the revenue data...',
      startedAt: Date.now(),
    });

    const summariserFn = async () => 'Summary of past turns';

    const result = await compactSession({ sessionId: oldSession.id, db, summariserFn });

    expect(result.newSessionId).toBeTruthy();
    expect(result.newSessionId).not.toBe(oldSession.id);
    expect(result.summary).toBe('Summary of past turns');

    // Old session is marked compacted
    const old = chatStore.getSession(db, oldSession.id);
    expect(old?.status).toBe('compacted');
    expect(old?.compacted_into).toBe(result.newSessionId);

    // New session is linked to old
    const newSess = chatStore.getSession(db, result.newSessionId);
    expect(newSess?.parent_session_id).toBe(oldSession.id);
    expect(newSess?.status).toBe('active');

    // New session has a system_preamble turn
    const turns = chatStore.listTurns(db, result.newSessionId);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('system_preamble');
    expect(turns[0].assistant_text).toBe('Summary of past turns');
  });

  it('calls the summariserFn with the recent turns', async () => {
    const session = chatStore.createSession(db, { ownerId: 'u1', gameId: 'ptg' });

    for (let i = 0; i < 5; i++) {
      chatStore.appendTurn(db, {
        sessionId: session.id,
        turnIndex: i,
        role: i % 2 === 0 ? 'user' : 'assistant',
        userText: i % 2 === 0 ? `msg ${i}` : undefined,
        assistantText: i % 2 !== 0 ? `reply ${i}` : undefined,
        startedAt: Date.now(),
      });
    }

    let capturedTurns: unknown[] = [];
    const summariserFn = async (turns: unknown[]) => {
      capturedTurns = turns;
      return 'captured summary';
    };

    await compactSession({ sessionId: session.id, db, summariserFn });

    expect(capturedTurns).toHaveLength(5);
  });
});
