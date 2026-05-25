/**
 * Tests for X-Model header resolution in POST /agent/turn.
 *
 * Covers:
 *   - allowlisted X-Model is honored (used in cache key + persisted model field)
 *   - non-allowlisted X-Model silently drops back to config.chatModel
 *   - missing X-Model → config.chatModel (server default)
 *
 * Uses an in-memory DB with cache enabled so we can inspect the model stored
 * in the response_cache key without touching the real Anthropic SDK.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';

// ---------------------------------------------------------------------------
// Config mock — cache enabled so resolvedModel ends up in the cache key
// ---------------------------------------------------------------------------

vi.mock('../../src/config.js', () => ({
  config: {
    port: 3005,
    logLevel: 'silent',
    anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://test.example',
    chatModel: 'claude-default',
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
    responseCacheEnabled: true,
    allowedModels: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'],
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
  getMetaVersion: vi.fn(async () => 'meta-v1'),
  extractMemberNames: vi.fn(() => new Set()),
  invalidate: vi.fn(),
  computeMetaVersion: vi.fn(() => 'meta-v1'),
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

vi.mock('../../src/core/session-manager.js', () => ({
  tryAcquire: vi.fn(async () => () => {}),
  TurnInProgressError: class TurnInProgressError extends Error {
    retryAfterMs = 1000;
  },
}));

// Mock claudeRunner to emit a minimal result immediately.
vi.mock('../../src/core/claude-runner.js', () => ({
  run: vi.fn(async function* () {
    yield { type: 'result', data: { text: 'hello', input_tokens: 10, output_tokens: 5 } };
  }),
}));

vi.mock('../../src/core/mode-prompts.js', () => ({
  compose: vi.fn(() => ({ systemPrompt: 'sys', allowedToolNames: [] })),
}));

vi.mock('../../src/core/intent-router.js', () => ({
  routeIntent: vi.fn(() => ({ skill: 'general', confidence: 1, autoRoute: true })),
}));

vi.mock('../../src/tools/registry.js', () => ({ buildSdkTools: vi.fn(() => []) }));

vi.mock('../../src/observability/llm-trace-recorder.js', () => ({
  LlmTraceRecorder: vi.fn().mockImplementation(() => ({})),
  BufferedLlmTraceRecorder: vi.fn().mockImplementation(() => ({ flush: vi.fn() })),
}));

vi.mock('../../src/observability/langfuse-tracer.js', () => ({
  LangfuseTracer: vi.fn().mockImplementation(() => ({
    finalize: vi.fn(),
    flush: vi.fn(async () => {}),
  })),
}));

vi.mock('../../src/observability/composite-observer.js', () => ({
  buildCompositeObserver: vi.fn(() => ({})),
}));

vi.mock('../../src/core/compact-service.js', () => ({
  shouldCompact: vi.fn(() => ({ shouldCompact: false })),
  compactSession: vi.fn(),
}));

vi.mock('../../src/cache/response-cache-write.js', () => ({
  maybeWriteResponseCache: vi.fn(),
}));

vi.mock('../../src/core/title-summariser.js', () => ({
  summariseTitle: vi.fn(async () => null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import turnRoutes from '../../src/api/turn.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildApp(db: Database.Database) {
  const fastify = Fastify({ logger: false });
  await fastify.register(turnRoutes, { db });
  await fastify.ready();
  return fastify;
}

function makeTurnBody(ownerId = 'owner1', game = 'g1') {
  return {
    owner_id: ownerId,
    game,
    message: 'test question',
  };
}

async function postTurn(
  app: ReturnType<typeof Fastify>,
  db: Database.Database,
  xModel?: string,
) {
  const ownerId = 'owner1';
  const game = 'g1';
  // Consume the SSE stream and return the final turn row from DB.
  const res = await app.inject({
    method: 'POST',
    url: '/agent/turn',
    headers: {
      'content-type': 'application/json',
      'x-cube-token': 'tok',
      'x-cube-game': game,
      'x-owner-id': ownerId,
      ...(xModel ? { 'x-model': xModel } : {}),
    },
    payload: JSON.stringify(makeTurnBody(ownerId, game)),
  });
  // Find the most-recently inserted assistant turn
  const turn = db
    .prepare(`SELECT * FROM chat_turns WHERE role = 'assistant' ORDER BY started_at DESC LIMIT 1`)
    .get() as { model: string } | undefined;
  return { status: res.statusCode, turn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('X-Model header resolution in /agent/turn', () => {
  let db: Database.Database;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    db = makeDb();
    app = await buildApp(db);
    mockRegistry.register.mockClear();
    mockRegistry.append.mockClear();
    mockRegistry.finish.mockClear();
  });

  it('uses server default model when X-Model header is absent', async () => {
    const { turn } = await postTurn(app, db);
    expect(turn?.model).toBe('claude-default');
  });

  it('honors allowlisted X-Model header', async () => {
    const { turn } = await postTurn(app, db, 'claude-haiku-4-5');
    expect(turn?.model).toBe('claude-haiku-4-5');
  });

  it('silently falls back to default for non-allowlisted X-Model', async () => {
    const { turn } = await postTurn(app, db, 'gpt-4o-ultra-secret');
    expect(turn?.model).toBe('claude-default');
  });

  it('silently falls back to default for empty X-Model header', async () => {
    const { turn } = await postTurn(app, db, '');
    expect(turn?.model).toBe('claude-default');
  });
});
