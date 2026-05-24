/**
 * Integration test for POST /agent/turn.
 * Boots Fastify with in-memory SQLite (no listen).
 * Mocks @anthropic-ai/claude-agent-sdk to emit canned messages.
 * Parses SSE events from the response body and asserts ordering.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';

// ---------------------------------------------------------------------------
// Mock the SDK — must be hoisted before importing modules that use it
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  // Canned SDK messages for a happy-path turn
  const cannedMessages = [
    {
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', thinking: 'Let me check the meta first.' }],
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu_001', name: 'get_cube_meta', input: { scope: 'compact' } },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_001',
            content: [{ type: 'text', text: '{"cubes":[]}' }],
          },
        ],
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Here is the revenue data.' }],
      },
    },
    {
      type: 'result',
      result: 'Here is the revenue data.',
      total_cost_usd: 0.001,
      usage: { input_tokens: 50, output_tokens: 30 },
    },
  ];

  async function* mockQuery() {
    for (const msg of cannedMessages) {
      yield msg;
    }
  }

  return {
    query: vi.fn(() => mockQuery()),
    createSdkMcpServer: vi.fn(() => ({
      type: 'sdk',
      name: 'test',
      instance: new EventEmitter(),
    })),
    tool: vi.fn((name: string, desc: string, _schema: unknown, handler: unknown) => ({
      name,
      description: desc,
      inputSchema: {},
      handler,
      annotations: {},
      _meta: undefined,
    })),
  };
});

// Also mock config so no env vars are needed
vi.mock('../src/config.js', () => ({
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
  },
}));

// ---------------------------------------------------------------------------
// Build the Fastify app after mocks are set up
// ---------------------------------------------------------------------------

import Fastify from 'fastify';
import healthRoutes from '../src/api/health.js';
import sessionsRoutes from '../src/api/sessions.js';
import turnRoutes from '../src/api/turn.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildTestApp() {
  const fastify = Fastify({ logger: false });
  const db = makeDb();
  await fastify.register(healthRoutes, { db });
  await fastify.register(sessionsRoutes, { db });
  await fastify.register(turnRoutes, { db });
  await fastify.ready();
  return { fastify, db };
}

// ---------------------------------------------------------------------------
// SSE line parser
// ---------------------------------------------------------------------------

interface SseParsedEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

function parseSseEvents(body: string): SseParsedEvent[] {
  const events: SseParsedEvent[] = [];
  const blocks = body.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let type = '';
    let dataStr = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) type = line.slice('event: '.length);
      if (line.startsWith('data: ')) dataStr = line.slice('data: '.length);
    }
    if (type) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any = {};
      try { data = JSON.parse(dataStr); } catch { data = dataStr; }
      events.push({ type, data });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /agent/turn integration', () => {
  let fastify: ReturnType<typeof Fastify>;
  let db: Database.Database;

  beforeAll(async () => {
    const app = await buildTestApp();
    fastify = app.fastify;
    db = app.db;
  });

  afterAll(async () => {
    await fastify.close();
    db.close();
  });

  it('streams expected SSE events in order for a new session', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-token': 'Bearer cube-token',
        'x-cube-game': 'ptg',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: 'owner1',
        game: 'ptg',
        message: 'show daily revenue',
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const events = parseSseEvents(response.body);
    const types = events.map((e) => e.type);

    // Must start with session_created, then turn_started, then loading.
    // `turn_started` carries the unguessable UUID turnId so a refreshed
    // client has a stable handle before any token arrives (Phase 5).
    expect(types[0]).toBe('session_created');
    expect(types[1]).toBe('turn_started');
    expect(types[2]).toBe('loading');

    // Must contain thinking, tool_call, tool_result, token
    expect(types).toContain('thinking');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('token');

    // Must end with result then done
    const lastTwo = types.slice(-2);
    expect(lastTwo).toEqual(['result', 'done']);
  });

  it('returns 400 when X-Cube-Token is missing', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-game': 'ptg',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: 'owner1',
        game: 'ptg',
        message: 'hello',
      }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when X-Cube-Game does not match body.game', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-token': 'Bearer t',
        'x-cube-game': 'wrong-game',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: 'owner1',
        game: 'ptg',
        message: 'hello',
      }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when session_id does not exist', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-token': 'Bearer t',
        'x-cube-game': 'ptg',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: 'nonexistent-session-id',
        owner_id: 'owner1',
        game: 'ptg',
        message: 'hello',
      }),
    });
    expect(response.statusCode).toBe(404);
  });

  it('session_created event contains a valid uuid', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/agent/turn',
      headers: {
        'content-type': 'application/json',
        'x-cube-token': 'Bearer t',
        'x-cube-game': 'ptg',
        'x-owner-id': 'owner1',
      },
      body: JSON.stringify({
        session_id: null,
        owner_id: 'owner1',
        game: 'ptg',
        message: 'test',
      }),
    });

    const events = parseSseEvents(response.body);
    const created = events.find((e) => e.type === 'session_created');
    expect(created).toBeDefined();
    expect(created!.data.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
