/**
 * Unit tests for maybeWriteResponseCache — exercises the skip-condition
 * matrix. The headline case here: when the disambiguator emitted a clarify
 * (chip) event for this turn, do NOT cache the response. Caching a
 * clarification freezes one user's chip surface and hides it from future
 * users whose session memory should auto-route them past the question.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { maybeWriteResponseCache } from '../../src/cache/response-cache-write.js';
import { getByKey } from '../../src/db/response-cache-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function baseParams(db: Database.Database) {
  return {
    db,
    enabled: true,
    key: 'k-test',
    gameId: 'g',
    skill: 'explore',
    model: 'claude-3-5-sonnet',
    userText: 'top spenders this week',
    assistantText: 'Which metric should I rank players by?',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.001,
    stopReason: 'end_turn' as string | undefined,
    collectedArtifacts: [],
    collectedCharts: [],
    hadError: false,
    turnId: 't1',
    sessionId: 's1',
  };
}

describe('maybeWriteResponseCache', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });

  it('writes a cache row for a normal completed turn', () => {
    expect(maybeWriteResponseCache(baseParams(db))).toBe(true);
    expect(getByKey(db, 'k-test')).not.toBeNull();
  });

  it('skips when disabled', () => {
    expect(maybeWriteResponseCache({ ...baseParams(db), enabled: false })).toBe(false);
    expect(getByKey(db, 'k-test')).toBeNull();
  });

  it('skips when assistantText empty', () => {
    expect(maybeWriteResponseCache({ ...baseParams(db), assistantText: '' })).toBe(false);
    expect(getByKey(db, 'k-test')).toBeNull();
  });

  it('skips when the turn ended in a disambiguation clarify (chips emitted)', () => {
    const ok = maybeWriteResponseCache({ ...baseParams(db), clarifyEmitted: true });
    expect(ok).toBe(false);
    expect(getByKey(db, 'k-test')).toBeNull();
  });

  it('still writes when clarifyEmitted is undefined (default behaviour)', () => {
    const params = baseParams(db);
    delete (params as Partial<typeof params>).stopReason; // tolerate unknown stop_reason
    expect(maybeWriteResponseCache(params)).toBe(true);
  });

  it('skips when stop_reason is explicitly non-end_turn (e.g. max_tokens)', () => {
    expect(maybeWriteResponseCache({ ...baseParams(db), stopReason: 'max_tokens' })).toBe(false);
  });

  it('skips when hadError is true', () => {
    expect(maybeWriteResponseCache({ ...baseParams(db), hadError: true })).toBe(false);
  });
});
