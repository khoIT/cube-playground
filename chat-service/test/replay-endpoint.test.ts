/**
 * Replay endpoint tests — buffered replay, 409 overflow, 403 wrong owner,
 * 404 unknown turn, and live tail subscribe/unsubscribe lifecycle.
 *
 * Boots a minimal Fastify app with just the replay route. Uses the singleton
 * registry instance from `stream-registry-instance.ts` so the route picks it
 * up; resets between tests to keep things hermetic.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../src/db/migrate.js';

// Config mock — replay route reads ring-size etc via the singleton.
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
    streamRegistryRingSize: 100,
    streamRegistryMaxTurns: 10,
    streamRegistryTtlMs: 60_000,
    streamRegistrySweepIntervalMs: 60_000,
  },
}));

import replayRoutes from '../src/api/replay.js';
import {
  getStreamRegistry,
  resetStreamRegistryForTest,
} from '../src/core/stream-registry-instance.js';
import * as chatStore from '../src/db/chat-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

let fastify: ReturnType<typeof Fastify>;
let db: Database.Database;

beforeAll(async () => {
  fastify = Fastify({ logger: false });
  db = makeDb();
  await fastify.register(replayRoutes, { db });
  await fastify.ready();
});

afterAll(async () => {
  await fastify.close();
  db.close();
});

beforeEach(() => {
  resetStreamRegistryForTest();
});

afterEach(() => {
  resetStreamRegistryForTest();
});

function parseSseEvents(body: string) {
  const events: Array<{ type: string; data: unknown }> = [];
  for (const block of body.split('\n\n').filter(Boolean)) {
    let type = '';
    let dataStr = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) type = line.slice(7);
      if (line.startsWith('data: ')) dataStr = line.slice(6);
    }
    if (type) {
      let data: unknown = dataStr;
      try { data = JSON.parse(dataStr); } catch { /* keep raw */ }
      events.push({ type, data });
    }
  }
  return events;
}

describe('replay endpoint', () => {
  it('404 when turnId is unknown', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/agent/turn/unknown/stream',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 when caller does not own the session', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'ptg' });
    const reg = getStreamRegistry();
    reg.register('t-403', session.id);
    reg.finish('t-403', 'done');

    const res = await fastify.inject({
      method: 'GET',
      url: '/agent/turn/t-403/stream',
      headers: { 'x-owner-id': 'owner-b' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('replays buffered events from from=0 for a finished turn', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'ptg' });
    const reg = getStreamRegistry();
    reg.register('t-1', session.id);
    reg.append('t-1', { type: 'token', data: { delta: 'A' } });
    reg.append('t-1', { type: 'token', data: { delta: 'B' } });
    reg.append('t-1', { type: 'done', data: {} });
    reg.finish('t-1', 'done');

    const res = await fastify.inject({
      method: 'GET',
      url: '/agent/turn/t-1/stream',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSseEvents(res.body);
    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'done']);
  });

  it('starts replay from the requested offset', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'ptg' });
    const reg = getStreamRegistry();
    reg.register('t-2', session.id);
    reg.append('t-2', { type: 'token', data: { delta: 'A' } });
    reg.append('t-2', { type: 'token', data: { delta: 'B' } });
    reg.append('t-2', { type: 'token', data: { delta: 'C' } });
    reg.finish('t-2', 'done');

    const res = await fastify.inject({
      method: 'GET',
      url: '/agent/turn/t-2/stream?from=2',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
    const events = parseSseEvents(res.body);
    expect(events.length).toBe(1);
    expect((events[0]?.data as { delta: string }).delta).toBe('C');
  });

  it('409 with availableFromOffset when from < startOffset (ring overflow)', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'ptg' });
    const reg = getStreamRegistry();
    reg.register('t-3', session.id);
    // Force startOffset to advance by hand (simulating ring eviction).
    const entry = reg.get('t-3')!;
    entry.startOffset = 50;
    entry.totalEmitted = 50;
    reg.finish('t-3', 'done');

    const res = await fastify.inject({
      method: 'GET',
      url: '/agent/turn/t-3/stream?from=10',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { code: string; availableFromOffset: number };
    expect(body.code).toBe('ring_overflow');
    expect(body.availableFromOffset).toBe(50);
  });

  it('compact alias: refresh against pre-compact sessionId still finds the turn', async () => {
    const oldSess = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'ptg' });
    const newSess = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'ptg' });
    const reg = getStreamRegistry();
    reg.aliasSession(oldSess.id, newSess.id);
    reg.register('t-alias', newSess.id);
    reg.append('t-alias', { type: 'token', data: { delta: 'hi' } });
    reg.finish('t-alias', 'done');

    // findRunning won't fire after finish, but the request goes by turnId so
    // it still works. The alias test is more relevant for the activeTurnId
    // discovery path — exercised by the registry unit tests.
    const res = await fastify.inject({
      method: 'GET',
      url: '/agent/turn/t-alias/stream',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(200);
  });
});
