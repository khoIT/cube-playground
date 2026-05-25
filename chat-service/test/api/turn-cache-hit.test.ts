/**
 * Integration tests for response-cache behaviour in POST /agent/turn.
 *
 * Covers:
 *   - cache miss on first request writes an entry
 *   - second identical request returns cache hit (no LLM call)
 *   - X-Bypass-Cache: 1 forces fresh LLM call even on hit
 *   - RESPONSE_CACHE_ENABLED=false (default) → no caching
 *   - tool-call turn → not cached (write-gate skips)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../../src/db/migrate.js';

// ---------------------------------------------------------------------------
// Hoist vi.mock calls — must appear before any imports of the mocked modules
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
    responseCacheEnabled: true,
  },
  isLangfuseEnabled: () => false,
}));

vi.mock('../../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

// Mock cube-meta-cache to return deterministic meta + version hash.
const FIXED_META_VERSION = 'fixed-meta-hash-abc123';
vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => ({ cubes: [] })),
  getMetaVersion: vi.fn(async () => FIXED_META_VERSION),
  extractMemberNames: vi.fn(() => new Set()),
  invalidate: vi.fn(),
  computeMetaVersion: vi.fn(() => FIXED_META_VERSION),
}));

// Mock stream-registry to avoid real background timers.
const mockRegistry = {
  register: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  aliasSession: vi.fn(),
};
vi.mock('../../src/core/stream-registry-instance.js', () => ({
  getStreamRegistry: () => mockRegistry,
}));

// Canned happy-path SDK messages (no tool calls, stop_reason = 'end_turn').
const CANNED_TEXT = 'Revenue was $1.2M last month.';

function makeSdkMessages() {
  return [
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: CANNED_TEXT }] },
    },
    {
      type: 'result',
      result: CANNED_TEXT,
      stop_reason: 'end_turn',
      total_cost_usd: 0.001,
      usage: { input_tokens: 50, output_tokens: 30 },
    },
  ];
}

// mockQuery is defined inside the factory to avoid hoisting issues.
// Accessed via vi.mocked() after imports.
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
// App builder
// ---------------------------------------------------------------------------

import turnRoutes from '../../src/api/turn.js';
import sessionsRoutes from '../../src/api/sessions.js';
import { config } from '../../src/config.js';
import * as sdkModule from '@anthropic-ai/claude-agent-sdk';

/** Typed reference to the hoisted mock query fn. */
function getMockQuery() {
  return vi.mocked(sdkModule.query);
}

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

// ---------------------------------------------------------------------------
// SSE parser helper
// ---------------------------------------------------------------------------

interface SseParsedEvent { type: string; data: unknown }

function parseSse(body: string): SseParsedEvent[] {
  return body
    .split('\n\n')
    .filter(Boolean)
    .flatMap((block) => {
      let type = '';
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) type = line.slice(7);
        if (line.startsWith('data: ')) dataStr = line.slice(6);
      }
      if (!type) return [];
      try { return [{ type, data: JSON.parse(dataStr) }]; }
      catch { return [{ type, data: dataStr }]; }
    });
}

function turnHeaders(game = 'ptg', owner = 'owner-1', extra: Record<string, string> = {}) {
  return {
    'content-type': 'application/json',
    'x-cube-token': 'Bearer cube-token',
    'x-cube-game': game,
    'x-owner-id': owner,
    ...extra,
  };
}

function turnBody(msg: string, game = 'ptg', owner = 'owner-1') {
  return JSON.stringify({ session_id: null, owner_id: owner, game, message: msg });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Response cache — POST /agent/turn', () => {
  let db: Database.Database;
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default: SDK mock returns happy-path messages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getMockQuery() as any).mockImplementation(async function* () {
      for (const msg of makeSdkMessages()) yield msg;
    });
    // Reset cache enabled to true for each test (mutate the mocked config object).
    (config as { responseCacheEnabled: boolean }).responseCacheEnabled = true;
    db = makeDb();
    fastify = await buildTestApp(db);
  });

  afterEach(async () => {
    await fastify.close();
    db.close();
  });

  // -------------------------------------------------------------------------
  it('cache miss — first request calls LLM and writes a cache entry', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: turnHeaders(), body: turnBody('show daily revenue'),
    });

    expect(res.statusCode).toBe(200);
    const events = parseSse(res.body);
    const types = events.map((e) => e.type);
    expect(types).toContain('result');
    expect(types).toContain('done');
    // LLM was called once
    expect(getMockQuery()).toHaveBeenCalledTimes(1);

    // A cache entry should now exist in the DB
    const rows = db.prepare('SELECT * FROM response_cache').all();
    expect(rows.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  it('cache hit — second identical request replays without LLM call', async () => {
    const msg = 'show monthly revenue';

    // First request — miss, LLM runs, entry written
    await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: turnHeaders(), body: turnBody(msg),
    });
    expect(getMockQuery()).toHaveBeenCalledTimes(1);
    getMockQuery().mockClear();

    // Second request — hit
    const res2 = await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: turnHeaders(), body: turnBody(msg),
    });

    expect(res2.statusCode).toBe(200);
    // LLM NOT called on second request
    expect(getMockQuery()).toHaveBeenCalledTimes(0);

    const events = parseSse(res2.body);
    const types = events.map((e) => e.type);
    expect(types).toContain('token');
    expect(types).toContain('result');
    expect(types).toContain('done');

    // result event has 0 tokens (cache replay)
    const resultEvt = events.find((e) => e.type === 'result');
    expect((resultEvt?.data as { input_tokens: number }).input_tokens).toBe(0);

    // chat_turns row for second request should have cache_hit = 1
    const turns = db.prepare(`SELECT * FROM chat_turns WHERE role = 'assistant' ORDER BY started_at DESC`).all() as Array<{ cache_hit: number; original_turn_id: string; stop_reason: string | null }>;
    expect(turns[0].cache_hit).toBe(1);
    expect(turns[0].original_turn_id).toBeTruthy();

    // N3: stop_reason must be 'end_turn' on cache-hit turns so leaderboard
    // successRate denominator is correct (NULL would inflate legacyCount).
    expect(turns[0].stop_reason).toBe('end_turn');

    // N2: replay stream must contain a 'loading' event (wire-shape parity with live turns).
    expect(types).toContain('loading');
    // loading comes before first token
    const loadingIdx = events.findIndex((e) => e.type === 'loading');
    const firstTokenIdx = events.findIndex((e) => e.type === 'token');
    expect(loadingIdx).toBeGreaterThanOrEqual(0);
    expect(loadingIdx).toBeLessThan(firstTokenIdx);
  });

  // -------------------------------------------------------------------------
  it('X-Bypass-Cache: 1 forces LLM call even on cache hit', async () => {
    const msg = 'total signups today';

    // First request — populates cache
    await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: turnHeaders(), body: turnBody(msg),
    });
    getMockQuery().mockClear();

    // Second request — bypass
    await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: { ...turnHeaders(), 'x-bypass-cache': '1' },
      body: turnBody(msg),
    });

    // LLM called again despite cache hit
    expect(getMockQuery()).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  it('cache disabled (responseCacheEnabled=false) — no cache reads or writes', async () => {
    (config as { responseCacheEnabled: boolean }).responseCacheEnabled = false;

    const msg = 'dau last week';
    await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: turnHeaders(), body: turnBody(msg),
    });
    // No cache entries
    expect(db.prepare('SELECT COUNT(*) AS n FROM response_cache').get()).toMatchObject({ n: 0 });

    // Second request also calls LLM (no cache)
    getMockQuery().mockClear();
    await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: turnHeaders(), body: turnBody(msg),
    });
    expect(getMockQuery()).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  it('normalisation — same message with different casing / whitespace hits cache', async () => {
    await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: turnHeaders(), body: turnBody('Show Revenue'),
    });
    getMockQuery().mockClear();

    await fastify.inject({
      method: 'POST', url: '/agent/turn',
      headers: turnHeaders(), body: turnBody('show  revenue.'),
    });
    // Second request should hit cache (no LLM call)
    expect(getMockQuery()).toHaveBeenCalledTimes(0);
  });
});
