/**
 * Boot-sweep tests: sessions whose latest turn is a stale user row get an
 * assistant 'service_restart' marker; live/completed sessions are untouched;
 * marker rows stay out of agent context but remain in FE history.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';
import {
  sweepOrphanedInFlightTurns,
  SERVICE_RESTART_STOP_REASON,
} from '../../src/db/sweep-orphaned-inflight-turns.js';

const NOW = 1_780_000_000_000;
const STALE = NOW - 120_000; // older than the 30s orphan threshold
const FRESH = NOW - 5_000; // younger than the threshold

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function seedSession(db: Database.Database): string {
  return chatStore.createSession(db, { ownerId: 'o1', gameId: 'g1', title: 't' }).id;
}

function addUserTurn(db: Database.Database, sessionId: string, idx: number, at: number) {
  chatStore.appendTurn(db, {
    sessionId,
    turnIndex: idx,
    role: 'user',
    userText: 'question',
    startedAt: at,
  });
}

function addAssistantTurn(db: Database.Database, sessionId: string, idx: number, at: number) {
  chatStore.appendTurn(db, {
    sessionId,
    turnIndex: idx,
    role: 'assistant',
    assistantText: 'answer',
    stopReason: 'end_turn',
    startedAt: at,
    endedAt: at + 1000,
  });
}

describe('sweepOrphanedInFlightTurns', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('marks a stale user-tail session with a service_restart assistant row', () => {
    const sid = seedSession(db);
    addUserTurn(db, sid, 0, STALE);

    const swept = sweepOrphanedInFlightTurns(db, NOW);

    expect(swept).toBe(1);
    const turns = chatStore.listTurns(db, sid);
    expect(turns).toHaveLength(2);
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].stop_reason).toBe(SERVICE_RESTART_STOP_REASON);
    expect(turns[1].assistant_text).toMatch(/interrupted/);
  });

  it('leaves completed sessions (assistant tail) untouched', () => {
    const sid = seedSession(db);
    addUserTurn(db, sid, 0, STALE);
    addAssistantTurn(db, sid, 1, STALE);

    expect(sweepOrphanedInFlightTurns(db, NOW)).toBe(0);
    expect(chatStore.listTurns(db, sid)).toHaveLength(2);
  });

  it('leaves fresh user-tail rows alone (request may still be booting)', () => {
    const sid = seedSession(db);
    addUserTurn(db, sid, 0, FRESH);

    expect(sweepOrphanedInFlightTurns(db, NOW)).toBe(0);
    expect(chatStore.listTurns(db, sid)).toHaveLength(1);
  });

  it('sweeps mid-conversation orphans, not just first turns', () => {
    const sid = seedSession(db);
    addUserTurn(db, sid, 0, STALE - 10_000);
    addAssistantTurn(db, sid, 1, STALE - 9_000);
    addUserTurn(db, sid, 2, STALE); // died mid-second-turn

    expect(sweepOrphanedInFlightTurns(db, NOW)).toBe(1);
    const turns = chatStore.listTurns(db, sid);
    expect(turns).toHaveLength(4);
    expect(turns[3].turn_index).toBe(3);
    expect(turns[3].stop_reason).toBe(SERVICE_RESTART_STOP_REASON);
  });

  it('is idempotent — a second sweep finds nothing', () => {
    const sid = seedSession(db);
    addUserTurn(db, sid, 0, STALE);
    expect(sweepOrphanedInFlightTurns(db, NOW)).toBe(1);
    expect(sweepOrphanedInFlightTurns(db, NOW)).toBe(0);
  });

  it('marker rows are hidden from agent context but visible in FE history', () => {
    const sid = seedSession(db);
    addUserTurn(db, sid, 0, STALE);
    sweepOrphanedInFlightTurns(db, NOW);

    const agentContext = chatStore.listTurnsRecent(db, sid, 10);
    expect(agentContext.some((t) => t.stop_reason === SERVICE_RESTART_STOP_REASON)).toBe(false);
    // FE listing keeps the marker so the user sees the interruption.
    const feHistory = chatStore.listTurns(db, sid);
    expect(feHistory.some((t) => t.stop_reason === SERVICE_RESTART_STOP_REASON)).toBe(true);
  });
});
