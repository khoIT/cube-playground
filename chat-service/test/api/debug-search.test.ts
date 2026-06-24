/**
 * Integration tests for GET /debug/search.
 *
 * Covers: LIKE match on user_text, assistant_text, tool args/result;
 * owner isolation; pagination via cursor; starred filter; empty q.
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

import debugSearchRoutes from '../../src/api/debug-search.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function seedTurnRaw(
  db: Database.Database,
  opts: {
    ownerId?: string;
    gameId?: string;
    userText?: string;
    assistantText?: string;
    startedAt?: number;
  } = {},
) {
  const ownerId = opts.ownerId ?? 'owner-a';
  const gameId = opts.gameId ?? 'g1';
  const session = chatStore.createSession(db, { ownerId, gameId, title: 'test session' });
  const turnId = 'turn-' + Math.random().toString(36).slice(2);
  const startedAt = opts.startedAt ?? Date.now();
  db.prepare(
    `INSERT INTO chat_turns (id, session_id, turn_index, role, user_text, assistant_text, started_at)
     VALUES (?, ?, 0, 'user', ?, ?, ?)`,
  ).run(turnId, session.id, opts.userText ?? null, opts.assistantText ?? null, startedAt);
  return { session, turnId, startedAt };
}

function seedToolInvocation(db: Database.Database, turnId: string, argsJson: string, resultSummary: string) {
  const id = 'tool-' + Math.random().toString(36).slice(2);
  db.prepare(
    `INSERT INTO tool_invocations (id, turn_id, tool_use_id, name, args_json, result_summary, ok)
     VALUES (?, ?, ?, 'testTool', ?, ?, 1)`,
  ).run(id, turnId, id, argsJson, resultSummary);
}

async function buildApp(db: Database.Database) {
  const fastify = Fastify({ logger: false });
  await fastify.register(debugSearchRoutes, { db });
  await fastify.ready();
  return fastify;
}

describe('GET /debug/search', () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });

  it('returns 401 without X-Owner-Id', async () => {
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/debug/search?q=hello' });
    expect(res.statusCode).toBe(401);
  });

  it('returns recent turns for blank q (default affordance)', async () => {
    seedTurnRaw(db, { userText: 'first turn', ownerId: 'owner-a', startedAt: 1000 });
    seedTurnRaw(db, { userText: 'second turn', ownerId: 'owner-a', startedAt: 2000 });
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/search?q=',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const { results, nextCursor } = res.json();
    // Most-recent first; no pagination on the default list.
    expect(results).toHaveLength(2);
    expect(results[0].snippet).toContain('second turn');
    expect(nextCursor).toBeNull();
  });

  it('blank q is owner-scoped and capped at limit', async () => {
    seedTurnRaw(db, { userText: 'mine', ownerId: 'owner-a' });
    seedTurnRaw(db, { userText: 'theirs', ownerId: 'owner-b' });
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET', url: '/debug/search?q=&limit=1',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain('mine');
  });

  it('matches user_text via LIKE', async () => {
    const app = await buildApp(db);
    seedTurnRaw(db, { userText: 'what is revenue today', ownerId: 'owner-a' });
    const res = await app.inject({
      method: 'GET', url: '/debug/search?q=revenue',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchSource).toBe('user_text');
    expect(results[0].snippet).toContain('revenue');
  });

  it('matches assistant_text via LIKE', async () => {
    const app = await buildApp(db);
    seedTurnRaw(db, { assistantText: 'The revenue metric shows 12k.', ownerId: 'owner-a' });
    const res = await app.inject({
      method: 'GET', url: '/debug/search?q=revenue metric',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const { results } = res.json();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchSource).toBe('assistant_text');
  });

  it('matches tool invocation args via subquery', async () => {
    const app = await buildApp(db);
    const { turnId } = seedTurnRaw(db, { ownerId: 'owner-a' });
    seedToolInvocation(db, turnId, '{"metric":"active_users"}', 'count: 500');
    const res = await app.inject({
      method: 'GET', url: '/debug/search?q=active_users',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const { results } = res.json();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchSource).toBe('tool');
  });

  it('owner isolation: owner-b cannot see owner-a turns', async () => {
    const app = await buildApp(db);
    seedTurnRaw(db, { userText: 'secret revenue data', ownerId: 'owner-a' });
    const res = await app.inject({
      method: 'GET', url: '/debug/search?q=secret',
      headers: { 'x-owner-id': 'owner-b' },
    });
    expect(res.json().results).toHaveLength(0);
  });

  it('cross-owner: two owners each see only their own turns', async () => {
    const app = await buildApp(db);
    seedTurnRaw(db, { userText: 'shared keyword alpha', ownerId: 'owner-a' });
    seedTurnRaw(db, { userText: 'shared keyword beta', ownerId: 'owner-b' });

    const resA = await app.inject({
      method: 'GET', url: '/debug/search?q=shared keyword',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const resB = await app.inject({
      method: 'GET', url: '/debug/search?q=shared keyword',
      headers: { 'x-owner-id': 'owner-b' },
    });

    const hitsA = resA.json().results as Array<{ snippet: string }>;
    const hitsB = resB.json().results as Array<{ snippet: string }>;

    expect(hitsA).toHaveLength(1);
    expect(hitsB).toHaveLength(1);
    expect(hitsA[0].snippet).toContain('alpha');
    expect(hitsB[0].snippet).toContain('beta');
  });

  it('cursor pagination returns stable next page', async () => {
    const app = await buildApp(db);
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      seedTurnRaw(db, { userText: 'paginate me', ownerId: 'owner-a', startedAt: now - i * 1000 });
    }
    const page1 = await app.inject({
      method: 'GET', url: '/debug/search?q=paginate&limit=3',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const body1 = page1.json();
    expect(body1.results).toHaveLength(3);
    expect(body1.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: 'GET', url: `/debug/search?q=paginate&limit=3&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: { 'x-owner-id': 'owner-a' },
    });
    const body2 = page2.json();
    expect(body2.results).toHaveLength(2);
    expect(body2.nextCursor).toBeNull();

    // No overlap between pages
    const ids1 = body1.results.map((r: { turnId: string }) => r.turnId);
    const ids2 = body2.results.map((r: { turnId: string }) => r.turnId);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it('starred filter returns only starred turns', async () => {
    const app = await buildApp(db);
    const { turnId: t1 } = seedTurnRaw(db, { userText: 'find me A', ownerId: 'owner-a' });
    seedTurnRaw(db, { userText: 'find me B', ownerId: 'owner-a' });

    // Star only t1 directly in DB
    db.prepare(
      `INSERT INTO turn_annotations (turn_id, owner_id, starred, updated_at) VALUES (?, ?, 1, ?)`,
    ).run(t1, 'owner-a', Date.now());

    const res = await app.inject({
      method: 'GET', url: '/debug/search?q=find me&starred=1',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const { results } = res.json();
    expect(results).toHaveLength(1);
    expect(results[0].turnId).toBe(t1);
    expect(results[0].starred).toBe(true);
  });

  it('result includes sessionTitle and role fields', async () => {
    const app = await buildApp(db);
    seedTurnRaw(db, { userText: 'hello world query', ownerId: 'owner-a' });
    const res = await app.inject({
      method: 'GET', url: '/debug/search?q=hello world',
      headers: { 'x-owner-id': 'owner-a' },
    });
    const hit = res.json().results[0];
    expect(hit).toHaveProperty('sessionId');
    expect(hit).toHaveProperty('sessionTitle');
    expect(hit).toHaveProperty('role');
    expect(hit).toHaveProperty('createdAt');
    expect(hit).toHaveProperty('snippet');
    expect(hit).toHaveProperty('matchSource');
  });
});
