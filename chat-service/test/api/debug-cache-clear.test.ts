/**
 * Tests for DELETE /debug/cache?game=<id>
 *
 * Covers:
 *   401 — missing X-Owner-Id
 *   400 — missing ?game=
 *   403 — owner has no sessions in this game
 *   200 — returns { deleted: <n> }; subsequent lookup finds no rows
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';
import { insertCacheEntry } from '../../src/db/response-cache-store.js';

vi.mock('../../src/config.js', () => ({
  config: {
    port: 3005, logLevel: 'silent', anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://test.example', chatModel: 'claude-test',
    chatMaxOutputTokens: 4096, serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000', chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40, chatMaxTokensPerTurn: 8000,
    streamRegistryRingSize: 100, streamRegistryMaxTurns: 10,
    streamRegistryTtlMs: 60_000, streamRegistrySweepIntervalMs: 60_000,
    rateLimitPerOwnerPerMin: 60, responseCacheEnabled: true,
    allowedModels: ['claude-sonnet-4-6'],
  },
  isLangfuseEnabled: () => false,
}));

vi.mock('../../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

import debugCacheClearRoutes from '../../src/api/debug-cache-clear.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildApp(db: Database.Database) {
  const fastify = Fastify({ logger: false });
  await fastify.register(debugCacheClearRoutes, { db });
  await fastify.ready();
  return fastify;
}

/** Seed one session + one cache entry for the given game; returns the cache key used. */
function seedGameData(
  db: Database.Database,
  ownerId: string,
  gameId: string,
  cacheKey = `key-${gameId}`,
): string {
  const session = chatStore.createSession(db, { ownerId, gameId, title: 'seed session' });
  // Insert a real assistant turn so the FK in response_cache is satisfied.
  const turnId = `turn-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO chat_turns (id, session_id, turn_index, role, started_at)
     VALUES (?, ?, 0, 'assistant', ?)`,
  ).run(turnId, session.id, Date.now());

  insertCacheEntry(db, {
    key: cacheKey,
    gameId,
    skill: 'general',
    model: 'claude-test',
    userTextNormalized: 'hello',
    value: { text: 'world', toolCalls: [] },
    inputTokens: 5,
    outputTokens: 3,
    costUsd: 0.001,
    originalTurnId: turnId,
    originalSessionId: session.id,
  });
  return cacheKey;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /debug/cache', () => {
  let db: Database.Database;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    db = makeDb();
    app = await buildApp(db);
  });

  it('returns 401 when X-Owner-Id header is missing', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/debug/cache?game=g1',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when ?game= query param is missing', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/debug/cache',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when ?game= is empty string', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/debug/cache?game=',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when owner has no sessions in the target game', async () => {
    // Seed a session for a DIFFERENT owner
    seedGameData(db, 'owner-other', 'g1');

    const res = await app.inject({
      method: 'DELETE',
      url: '/debug/cache?game=g1',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when the game does not exist at all', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/debug/cache?game=nonexistent-game',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deletes cache rows for the game and returns { deleted: n }', async () => {
    seedGameData(db, 'owner-a', 'g1', 'key-1');
    seedGameData(db, 'owner-a', 'g1', 'key-2');

    const res = await app.inject({
      method: 'DELETE',
      url: '/debug/cache?game=g1',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { deleted: number };
    expect(body.deleted).toBe(2);

    // Confirm rows are actually gone
    const remaining = db
      .prepare('SELECT COUNT(*) as cnt FROM response_cache WHERE game_id = ?')
      .get('g1') as { cnt: number };
    expect(remaining.cnt).toBe(0);
  });

  it('returns { deleted: 0 } when game has sessions but no cache entries', async () => {
    // Create a session but no cache entries
    chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g-empty', title: 'empty' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/debug/cache?game=g-empty',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { deleted: number };
    expect(body.deleted).toBe(0);
  });

  it('only clears rows for the target game, not other games', async () => {
    seedGameData(db, 'owner-a', 'g1', 'key-g1');
    seedGameData(db, 'owner-a', 'g2', 'key-g2');

    await app.inject({
      method: 'DELETE',
      url: '/debug/cache?game=g1',
      headers: { 'x-owner-id': 'owner-a' },
    });

    const g2Rows = db
      .prepare('SELECT COUNT(*) as cnt FROM response_cache WHERE game_id = ?')
      .get('g2') as { cnt: number };
    expect(g2Rows.cnt).toBe(1);
  });
});
