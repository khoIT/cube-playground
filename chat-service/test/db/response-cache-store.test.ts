/**
 * Unit tests for response-cache-store.ts:
 *   getByKey, insertCacheEntry, incrementHit, purgeExpired, clearForGame
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  getByKey,
  insertCacheEntry,
  incrementHit,
  purgeExpired,
  clearForGame,
  type InsertCacheParams,
} from '../../src/db/response-cache-store.js';

// Silence config validation — not needed for DB-only tests.
import { vi } from 'vitest';
vi.mock('../../src/config.js', () => ({
  config: {
    port: 3005, logLevel: 'silent', anthropicApiKey: 'test',
    anthropicBaseUrl: 'https://test', chatModel: 'claude-test',
    chatMaxOutputTokens: 4096, serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000', chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40, chatMaxTokensPerTurn: 8000,
    skillLoaderTtlMs: 5000, contextBudgetTokens: 180000,
    titleModel: 'claude-haiku', rateLimitPerOwnerPerMin: 30,
    costPer1kInputUsd: 0.003, costPer1kOutputUsd: 0.015,
    mcpEnabled: false, starterRankMinSessions: 3,
    disambigAutoThreshold: 0.75, mainServerServiceToken: '',
    streamRegistryRingSize: 100, streamRegistryMaxTurns: 10,
    streamRegistryTtlMs: 60000, streamRegistrySweepIntervalMs: 60000,
    langfusePublicKey: '', langfuseSecretKey: '',
    langfuseBaseUrl: 'https://cloud.langfuse.com',
    responseCacheEnabled: false,
  },
}));

vi.mock('../../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function makeParams(overrides: Partial<InsertCacheParams> = {}): InsertCacheParams {
  return {
    key: 'key-1',
    gameId: 'game-abc',
    skill: 'explore',
    model: 'claude-test',
    userTextNormalized: 'show revenue',
    value: { text: 'Revenue was $1M.', toolCalls: [] },
    inputTokens: 1000,
    outputTokens: 400,
    costUsd: 0.005,
    originalTurnId: 'turn-orig',
    originalSessionId: 'session-orig',
    ...overrides,
  };
}

describe('response-cache-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  // -------------------------------------------------------------------------
  // getByKey + insertCacheEntry
  // -------------------------------------------------------------------------

  it('returns null on miss', () => {
    expect(getByKey(db, 'nonexistent')).toBeNull();
  });

  it('returns the row on hit after insert', () => {
    insertCacheEntry(db, makeParams());
    const row = getByKey(db, 'key-1');
    expect(row).not.toBeNull();
    expect(row!.key).toBe('key-1');
    expect(row!.game_id).toBe('game-abc');
    expect(row!.skill).toBe('explore');
    expect(row!.original_turn_id).toBe('turn-orig');
    expect(row!.original_session_id).toBe('session-orig');
    expect(row!.hit_count).toBe(0);
    expect(row!.last_hit_at).toBeNull();
  });

  it('stores and retrieves value_json faithfully', () => {
    insertCacheEntry(db, makeParams({ value: { text: 'Hello cache', toolCalls: [] } }));
    const row = getByKey(db, 'key-1');
    const v = JSON.parse(row!.value_json);
    expect(v.text).toBe('Hello cache');
  });

  it('INSERT OR IGNORE on duplicate key — second write is no-op', () => {
    insertCacheEntry(db, makeParams({ value: { text: 'first', toolCalls: [] } }));
    insertCacheEntry(db, makeParams({ value: { text: 'second', toolCalls: [] } }));
    const row = getByKey(db, 'key-1');
    expect(JSON.parse(row!.value_json).text).toBe('first');
  });

  // -------------------------------------------------------------------------
  // incrementHit
  // -------------------------------------------------------------------------

  it('increments hit_count and sets last_hit_at', () => {
    insertCacheEntry(db, makeParams());
    const before = Date.now();
    incrementHit(db, 'key-1');
    const row = getByKey(db, 'key-1');
    expect(row!.hit_count).toBe(1);
    expect(row!.last_hit_at).toBeGreaterThanOrEqual(before);
  });

  it('accumulates multiple increments', () => {
    insertCacheEntry(db, makeParams());
    incrementHit(db, 'key-1');
    incrementHit(db, 'key-1');
    incrementHit(db, 'key-1');
    expect(getByKey(db, 'key-1')!.hit_count).toBe(3);
  });

  it('is a no-op on nonexistent key', () => {
    expect(() => incrementHit(db, 'ghost')).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // purgeExpired
  // -------------------------------------------------------------------------

  it('purges rows older than cutoff', () => {
    const old = Date.now() - 100_000;
    // Manually insert with old created_at
    db.prepare(
      `INSERT INTO response_cache
         (key, game_id, skill, model, user_text_normalized, value_json,
          input_tokens, output_tokens, cost_usd, hit_count, created_at,
          original_turn_id, original_session_id)
       VALUES ('old-key', 'g1', 'explore', 'claude-test', 'q', '{}',
               0, 0, 0, 0, ?, 'turn-x', 'sess-x')`,
    ).run(old);
    insertCacheEntry(db, makeParams({ key: 'new-key' }));

    const purged = purgeExpired(db, Date.now() - 50_000);
    expect(purged).toBe(1);
    expect(getByKey(db, 'old-key')).toBeNull();
    expect(getByKey(db, 'new-key')).not.toBeNull();
  });

  it('returns 0 when nothing to purge', () => {
    insertCacheEntry(db, makeParams());
    expect(purgeExpired(db, Date.now() - 100_000_000)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // clearForGame
  // -------------------------------------------------------------------------

  it('deletes all rows for a game_id', () => {
    insertCacheEntry(db, makeParams({ key: 'k1', gameId: 'g-target' }));
    insertCacheEntry(db, makeParams({ key: 'k2', gameId: 'g-target' }));
    insertCacheEntry(db, makeParams({ key: 'k3', gameId: 'g-other' }));

    const deleted = clearForGame(db, 'g-target');
    expect(deleted).toBe(2);
    expect(getByKey(db, 'k1')).toBeNull();
    expect(getByKey(db, 'k2')).toBeNull();
    expect(getByKey(db, 'k3')).not.toBeNull();
  });

  it('returns 0 when game has no entries', () => {
    expect(clearForGame(db, 'no-such-game')).toBe(0);
  });
});
