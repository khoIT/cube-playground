/**
 * Tests for GET /debug/search/cached?q=&game=&limit=
 *
 * Covers:
 *   401 — missing X-Owner-Id
 *   403-equivalent — owner without session in game sees no rows (empty result)
 *   200 q filter works — only rows matching LIKE %q% are returned
 *   200 game filter works — only rows for the given game
 *   200 owner isolation — owner-B cannot see owner-A's cache entries
 *   200 pagination — limit param respected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';
import { insertCacheEntry } from '../../src/db/response-cache-store.js';
import debugSearchCachedRoutes from '../../src/api/debug-search-cached.js';

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
  await fastify.register(debugSearchCachedRoutes, { db });
  await fastify.ready();
  return fastify;
}

/** Seed a session + a cache entry; returns { sessionId, turnId, cacheKey }. */
function seedEntry(
  db: Database.Database,
  opts: {
    ownerId: string;
    gameId: string;
    userText: string;
    skill?: string;
    cacheKey?: string;
  },
): { sessionId: string; turnId: string; cacheKey: string } {
  const session = chatStore.createSession(db, {
    ownerId: opts.ownerId,
    gameId: opts.gameId,
    title: `session-${opts.gameId}`,
  });
  const turnId = `turn-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO chat_turns (id, session_id, turn_index, role, started_at)
     VALUES (?, ?, 0, 'assistant', ?)`,
  ).run(turnId, session.id, Date.now());

  const cacheKey = opts.cacheKey ?? `key-${Math.random().toString(36).slice(2)}`;
  insertCacheEntry(db, {
    key: cacheKey,
    gameId: opts.gameId,
    skill: opts.skill ?? 'general',
    model: 'claude-test',
    userTextNormalized: opts.userText,
    value: { text: 'cached response', toolCalls: [] },
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.001,
    originalTurnId: turnId,
    originalSessionId: session.id,
  });
  return { sessionId: session.id, turnId, cacheKey };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /debug/search/cached', () => {
  let db: Database.Database;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    db = makeDb();
    app = await buildApp(db);
  });

  it('returns 401 when X-Owner-Id header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/debug/search/cached?q=test' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty results when owner has no sessions in any game', async () => {
    // Seed entry for a different owner
    seedEntry(db, { ownerId: 'other-owner', gameId: 'g1', userText: 'hello world' });

    const res = await app.inject({
      method: 'GET',
      url: '/debug/search/cached?q=hello',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: unknown[] };
    expect(body.results).toHaveLength(0);
  });

  it('owner isolation: owner-B cannot see owner-A cache entries', async () => {
    seedEntry(db, { ownerId: 'owner-a', gameId: 'g1', userText: 'retention analysis' });

    const res = await app.inject({
      method: 'GET',
      url: '/debug/search/cached?q=retention',
      headers: { 'x-owner-id': 'owner-b' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: unknown[] };
    expect(body.results).toHaveLength(0);
  });

  it('returns matching rows when owner has sessions in the game', async () => {
    seedEntry(db, { ownerId: 'owner-a', gameId: 'g1', userText: 'retention by platform' });
    seedEntry(db, { ownerId: 'owner-a', gameId: 'g1', userText: 'dau trend last 30 days' });

    const res = await app.inject({
      method: 'GET',
      url: '/debug/search/cached?q=retention',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: Array<{ user_text_snippet: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].user_text_snippet).toContain('retention');
  });

  it('empty q returns all rows visible to owner (no LIKE filter)', async () => {
    seedEntry(db, { ownerId: 'owner-a', gameId: 'g1', userText: 'alpha query' });
    seedEntry(db, { ownerId: 'owner-a', gameId: 'g1', userText: 'beta query' });

    const res = await app.inject({
      method: 'GET',
      url: '/debug/search/cached',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: unknown[] };
    expect(body.results).toHaveLength(2);
  });

  it('game filter restricts results to the specified game', async () => {
    seedEntry(db, { ownerId: 'owner-a', gameId: 'g1', userText: 'shared query' });
    seedEntry(db, { ownerId: 'owner-a', gameId: 'g2', userText: 'shared query' });

    const res = await app.inject({
      method: 'GET',
      url: '/debug/search/cached?q=shared&game=g1',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: Array<{ game_id: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].game_id).toBe('g1');
  });

  it('limit param is respected', async () => {
    for (let i = 0; i < 5; i++) {
      seedEntry(db, { ownerId: 'owner-a', gameId: 'g1', userText: `query number ${i}` });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/debug/search/cached?limit=3',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: unknown[] };
    expect(body.results.length).toBeLessThanOrEqual(3);
  });

  it('cross-owner same-game isolation: owner-B cannot see owner-A entries when both have sessions in game', async () => {
    // Both owners have sessions in g1 — old EXISTS-based filter would leak owner-A's entries to owner-B
    seedEntry(db, { ownerId: 'owner-a', gameId: 'g1', userText: 'owner-a secret query' });
    // Give owner-b their own session in the same game
    const ownerBSession = chatStore.createSession(db, { ownerId: 'owner-b', gameId: 'g1', title: 'b-session' });
    // Owner-b has their own unrelated cache entry
    const bTurnId = `turn-${Math.random().toString(36).slice(2)}`;
    db.prepare(
      `INSERT INTO chat_turns (id, session_id, turn_index, role, started_at) VALUES (?, ?, 0, 'assistant', ?)`,
    ).run(bTurnId, ownerBSession.id, Date.now());
    insertCacheEntry(db, {
      key: `key-b-${Math.random().toString(36).slice(2)}`,
      gameId: 'g1', skill: 'general', model: 'claude-test',
      userTextNormalized: 'owner-b own query',
      value: { text: 'resp', toolCalls: [] },
      inputTokens: 5, outputTokens: 3, costUsd: 0.001,
      originalTurnId: bTurnId, originalSessionId: ownerBSession.id,
    });

    // Owner-B should only see their own entries, NOT owner-A's
    const res = await app.inject({
      method: 'GET',
      url: '/debug/search/cached',
      headers: { 'x-owner-id': 'owner-b' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: Array<{ user_text_snippet: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].user_text_snippet).toContain('owner-b own query');
    expect(body.results.some((r) => r.user_text_snippet.includes('owner-a'))).toBe(false);
  });

  it('result rows have the expected shape', async () => {
    const { sessionId, turnId } = seedEntry(db, {
      ownerId: 'owner-a',
      gameId: 'g1',
      userText: 'test query shape',
      skill: 'metric-explorer',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/debug/search/cached?q=test',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      results: Array<{
        key: string; game_id: string; skill: string; model: string;
        user_text_snippet: string; hit_count: number; cost_usd: number;
        last_hit_at: number | null; original_turn_id: string; original_session_id: string;
      }>;
    };
    expect(body.results).toHaveLength(1);
    const row = body.results[0];
    expect(row.game_id).toBe('g1');
    expect(row.skill).toBe('metric-explorer');
    expect(row.user_text_snippet).toContain('test query shape');
    expect(row.original_turn_id).toBe(turnId);
    expect(row.original_session_id).toBe(sessionId);
    expect(typeof row.hit_count).toBe('number');
    expect(typeof row.cost_usd).toBe('number');
  });
});
