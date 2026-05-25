/**
 * C2 regression — POST /agent/turn must return 404 for soft-deleted sessions.
 *
 * Before fix: getSession had no deleted_at filter, so deleted sessions could
 * silently receive turns (silent resurrection while deleted_at stays set).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../../src/db/migrate.js';

// ---------------------------------------------------------------------------
// Hoist mocks (same config as other turn tests)
// ---------------------------------------------------------------------------

vi.mock('../../src/config.js', () => ({
  config: {
    port: 3005,
    logLevel: 'silent',
    anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://test.example',
    chatModel: 'claude-test',
    chatMaxOutputTokens: 4096,
    serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000',
    chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40,
    chatMaxTokensPerTurn: 8000,
    skillLoaderTtlMs: 5000,
    contextBudgetTokens: 180_000,
    titleModel: 'claude-haiku',
    rateLimitPerOwnerPerMin: 60,
    costPer1kInputUsd: 0.003,
    costPer1kOutputUsd: 0.015,
    mcpEnabled: false,
    starterRankMinSessions: 3,
    disambigAutoThreshold: 0.75,
    mainServerServiceToken: '',
    streamRegistryRingSize: 200,
    streamRegistryMaxTurns: 50,
    streamRegistryTtlMs: 300_000,
    streamRegistrySweepIntervalMs: 60_000,
    langfusePublicKey: '',
    langfuseSecretKey: '',
    langfuseBaseUrl: 'https://cloud.langfuse.com',
    responseCacheEnabled: false,
  },
  isLangfuseEnabled: () => false,
}));

vi.mock('../../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => ({ cubes: [] })),
  getMetaVersion: vi.fn(async () => 'hash-abc'),
  extractMemberNames: vi.fn(() => new Set()),
  invalidate: vi.fn(),
  computeMetaVersion: vi.fn(() => 'hash-abc'),
}));

const mockRegistry = {
  register: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  aliasSession: vi.fn(),
};
vi.mock('../../src/core/stream-registry-instance.js', () => ({
  getStreamRegistry: () => mockRegistry,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(() => ({
    type: 'sdk', name: 'test', instance: new EventEmitter(),
  })),
  tool: vi.fn((name: string, desc: string, _schema: unknown, handler: unknown) => ({
    name, description: desc, inputSchema: {}, handler, annotations: {}, _meta: undefined,
  })),
}));

// ---------------------------------------------------------------------------

import turnRoutes from '../../src/api/turn.js';
import sessionsRoutes from '../../src/api/sessions.js';
import * as chatStore from '../../src/db/chat-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildTestApp(db: Database.Database) {
  const fastify = Fastify({ logger: false });
  await fastify.register(sessionsRoutes, { db });
  await fastify.register(turnRoutes, { db });
  await fastify.ready();
  return fastify;
}

function turnHeaders(owner = 'owner-1', game = 'ptg') {
  return {
    'content-type': 'application/json',
    'x-cube-token': 'Bearer cube-token',
    'x-cube-game': game,
    'x-owner-id': owner,
  };
}

// ---------------------------------------------------------------------------

describe('POST /agent/turn — soft-deleted session (C2)', () => {
  let db: Database.Database;
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = makeDb();
    fastify = await buildTestApp(db);
  });

  afterEach(async () => {
    await fastify.close();
    db.close();
  });

  it('returns 404 when session_id refers to a soft-deleted session', async () => {
    // Create a real session then soft-delete it
    const session = chatStore.createSession(db, { ownerId: 'owner-1', gameId: 'ptg', title: 'test' });
    chatStore.softDeleteSession(db, session.id);

    const res = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: turnHeaders(),
      body: JSON.stringify({
        session_id: session.id,
        owner_id: 'owner-1',
        game: 'ptg',
        message: 'hello after delete',
      }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Session not found' });
  });

  it('returns 404 for a session_id that does not exist', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: turnHeaders(),
      body: JSON.stringify({
        session_id: 'non-existent-uuid',
        owner_id: 'owner-1',
        game: 'ptg',
        message: 'hello',
      }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Session not found' });
  });

  it('allows posting to an active (non-deleted) session', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-1', gameId: 'ptg', title: 'active' });

    // SDK mock needs to return something to avoid hanging — same cast pattern as turn-cache-hit.test.ts
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(query) as any).mockImplementation(async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
      yield { type: 'result', result: 'ok', stop_reason: 'end_turn', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
    });

    const res = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: turnHeaders(),
      body: JSON.stringify({
        session_id: session.id,
        owner_id: 'owner-1',
        game: 'ptg',
        message: 'hello active',
      }),
    });

    // 200 SSE stream opened successfully
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });
});
