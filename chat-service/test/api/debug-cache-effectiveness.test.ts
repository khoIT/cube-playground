/**
 * Integration tests for GET /debug/cache-effectiveness.
 *
 * Covers:
 *   - 401 when X-Owner-Id missing
 *   - 400 for invalid days / topN params
 *   - 403 when gameId provided but owner has no sessions in that game
 *   - 200 with correct shape on happy path
 *   - days clamp: days > 90 rejected; days < 1 rejected
 *   - topN clamp: topN > 100 rejected; topN < 1 rejected
 *   - gameId omitted → cross-game aggregate for owner
 *   - gameId present + owner has session → 200
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';

vi.mock('../../src/config.js', () => ({
  config: {
    port: 3005, logLevel: 'silent', anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://test.example', chatModel: 'claude-test',
    chatMaxOutputTokens: 4096, serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000', chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40, chatMaxTokensPerTurn: 8000,
    streamRegistryRingSize: 100, streamRegistryMaxTurns: 10,
    streamRegistryTtlMs: 60_000, streamRegistrySweepIntervalMs: 60_000,
    rateLimitPerOwnerPerMin: 60,
  },
}));

vi.mock('../../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

import debugCacheEffectivenessRoutes from '../../src/api/debug-cache-effectiveness.js';

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
  await fastify.register(debugCacheEffectivenessRoutes, { db });
  await fastify.ready();
  return fastify;
}

function seedSession(db: Database.Database, ownerId: string, gameId: string): string {
  return chatStore.createSession(db, { ownerId, gameId, title: 'test' }).id;
}

function seedTurn(db: Database.Database, sessionId: string, cacheHit = 0): string {
  const turnId = 'turn-' + Math.random().toString(36).slice(2);
  db.prepare(
    `INSERT INTO chat_turns
       (id, session_id, turn_index, role, skill, model, started_at, ended_at, cost_usd, cache_hit, stop_reason)
     VALUES (?, ?, 0, 'assistant', 'analytics', 'claude-test', ?, ?, 0.005, ?, 'end_turn')`,
  ).run(turnId, sessionId, Date.now(), Date.now() + 100, cacheHit);
  return turnId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /debug/cache-effectiveness', () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });

  it('returns 401 without X-Owner-Id header', async () => {
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/debug/cache-effectiveness' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/X-Owner-Id/i);
  });

  it('returns 400 for days=0 (below min)', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?days=0',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for days=91 (above max)', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?days=91',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for topN=0 (below min)', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?topN=0',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for topN=101 (above max)', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?topN=101',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for non-numeric days', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?days=abc',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when gameId is given but owner has no sessions in that game', async () => {
    const app = await buildApp(db);
    // owner-a has sessions in game-other, not game-secret
    seedSession(db, 'owner-a', 'game-other');

    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?game=game-secret',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/No sessions/i);
  });

  it('returns 200 with correct shape on empty DB', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('sparkline');
    expect(body).toHaveProperty('topQueries');
    expect(body).toHaveProperty('staleRatio');
    expect(body).toHaveProperty('currentMetaHash');
    expect(body).toHaveProperty('computedAt');
    expect(body.summary.hitRate).toBe(0);
    expect(body.sparkline).toHaveLength(30); // default days=30
    expect(body.topQueries).toHaveLength(0);
  });

  it('returns 200 with data when owner has sessions and turns', async () => {
    const app = await buildApp(db);
    const sessId = seedSession(db, 'owner-a', 'game-1');
    seedTurn(db, sessId, 1);
    seedTurn(db, sessId, 0);

    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.hitRate).toBeCloseTo(0.5);
  });

  it('gameId present + owner has session → 200', async () => {
    const app = await buildApp(db);
    const sessId = seedSession(db, 'owner-a', 'game-1');
    seedTurn(db, sessId, 0);

    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?game=game-1',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('gameId omitted returns cross-game aggregate for owner', async () => {
    const app = await buildApp(db);
    const s1 = seedSession(db, 'owner-a', 'game-1');
    const s2 = seedSession(db, 'owner-a', 'game-2');
    seedTurn(db, s1, 1);
    seedTurn(db, s2, 0);

    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    // 1 hit out of 2 total turns across two games
    expect(res.json().summary.hitRate).toBeCloseTo(0.5);
  });

  it('sparkline length matches days param', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?days=7',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sparkline).toHaveLength(7);
  });

  it('topN param limits returned queries', async () => {
    const app = await buildApp(db);
    const sessId = seedSession(db, 'owner-a', 'game-1');
    // Insert 5 cache rows
    for (let i = 0; i < 5; i++) {
      const t = seedTurn(db, sessId);
      db.prepare(
        `INSERT OR IGNORE INTO response_cache
           (key, game_id, skill, model, user_text_normalized, value_json,
            input_tokens, output_tokens, cost_usd, hit_count, created_at,
            original_turn_id, original_session_id)
         VALUES (?, 'game-1', 'analytics', 'claude-test', 'q', '{}', 100, 50, 0.001, ?, ?, ?, ?)`,
      ).run(`key-${i}`, i + 1, Date.now(), t, sessId);
    }

    const res = await app.inject({
      method: 'GET', url: '/debug/cache-effectiveness?topN=3',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().topQueries).toHaveLength(3);
  });
});
