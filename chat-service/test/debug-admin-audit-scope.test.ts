/**
 * Admin audit scope on /debug routes — the gateway-set X-Debug-Admin header
 * grants cross-owner READ access (session list scope=all, session detail,
 * turn detail, raw events) while mutations stay strictly owner-scoped.
 *
 * Also locks the fail-closed paths: scope=all WITHOUT the header stays
 * self-scoped, and a spoofed header on a mutation still 403s.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { migrate } from '../src/db/migrate.js';

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
    rateLimitPerOwnerPerMin: 60,
  },
}));

vi.mock('../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

import sessionsRoutes from '../src/api/sessions.js';
import debugRoutes from '../src/api/debug.js';
import * as chatStore from '../src/db/chat-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildTestApp(db: Database.Database) {
  const fastify = Fastify({ logger: false });
  await fastify.register(sessionsRoutes, { db });
  await fastify.register(debugRoutes, { db });
  await fastify.ready();
  return fastify;
}

const ADMIN = { 'x-owner-id': 'admin-sub', 'x-debug-admin': '1' };

describe('debug admin audit scope', () => {
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let aliceSessionId: string;
  let aliceTurnId: string;

  beforeAll(async () => {
    db = makeDb();
    app = await buildTestApp(db);
    const s = chatStore.createSession(db, { ownerId: 'alice-sub', gameId: 'g1' });
    aliceSessionId = s.id;
    const turn = chatStore.appendTurn(db, {
      sessionId: s.id,
      turnIndex: 0,
      role: 'assistant',
      assistantText: 'hello',
      startedAt: Date.now(),
    });
    aliceTurnId = turn.id;
    chatStore.createSession(db, { ownerId: 'bob-sub', gameId: 'g1' });
  });

  afterAll(() => app.close());

  it('scope=all + admin header lists every owner; rows carry owner_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/debug/sessions?scope=all',
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const owners = (res.json() as Array<{ owner_id: string }>).map((s) => s.owner_id).sort();
    expect(owners).toEqual(['alice-sub', 'bob-sub']);
  });

  it('scope=all WITHOUT the admin header stays self-scoped (fail-closed)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/debug/sessions?scope=all',
      headers: { 'x-owner-id': 'alice-sub' },
    });
    expect(res.statusCode).toBe(200);
    const owners = (res.json() as Array<{ owner_id: string }>).map((s) => s.owner_id);
    expect(owners).toEqual(['alice-sub']);
  });

  it('admin header grants cross-owner session detail, turn detail, raw reads', async () => {
    const detail = await app.inject({
      method: 'GET',
      url: `/debug/sessions/${aliceSessionId}`,
      headers: ADMIN,
    });
    expect(detail.statusCode).toBe(200);

    const turn = await app.inject({
      method: 'GET',
      url: `/debug/turns/${aliceTurnId}`,
      headers: ADMIN,
    });
    expect(turn.statusCode).toBe(200);

    const raw = await app.inject({
      method: 'GET',
      url: `/debug/turns/${aliceTurnId}/raw`,
      headers: ADMIN,
    });
    expect(raw.statusCode).toBe(200);
  });

  it('cross-owner reads WITHOUT the header still 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/debug/sessions/${aliceSessionId}`,
      headers: { 'x-owner-id': 'bob-sub' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('mutations stay owner-scoped even WITH the admin header (read-only boundary)', async () => {
    chatStore.softDeleteSession(db, aliceSessionId);

    const restore = await app.inject({
      method: 'POST',
      url: `/debug/sessions/${aliceSessionId}/restore`,
      headers: ADMIN,
    });
    expect(restore.statusCode).toBe(403);

    const purge = await app.inject({
      method: 'DELETE',
      url: `/debug/sessions/${aliceSessionId}`,
      headers: ADMIN,
    });
    expect(purge.statusCode).toBe(403);

    // Restore state for any later assertions.
    chatStore.restoreSession(db, aliceSessionId);
  });

  // -------------------------------------------------------------------------
  // llmAuthLabel field is exposed in /debug/sessions/:id turn list
  // -------------------------------------------------------------------------

  it('session detail turns include llmAuthLabel — set value when persisted', async () => {
    // Create a fresh session with a turn that has a known auth lane.
    const laneSession = chatStore.createSession(db, { ownerId: 'alice-sub', gameId: 'g1' });
    chatStore.appendTurn(db, {
      sessionId: laneSession.id,
      turnIndex: 0,
      role: 'assistant',
      assistantText: 'hello lane',
      llmAuthLabel: 'primary',
      startedAt: Date.now(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/debug/sessions/${laneSession.id}`,
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { turns: Array<{ llmAuthLabel: unknown }> };
    expect(body.turns).toHaveLength(1);
    expect(body.turns[0].llmAuthLabel).toBe('primary');
  });

  it('session detail turns include llmAuthLabel — null for legacy turns without the field', async () => {
    // Turn appended without llmAuthLabel (simulates a legacy row).
    const legacySession = chatStore.createSession(db, { ownerId: 'alice-sub', gameId: 'g1' });
    chatStore.appendTurn(db, {
      sessionId: legacySession.id,
      turnIndex: 0,
      role: 'assistant',
      assistantText: 'legacy',
      startedAt: Date.now(),
      // no llmAuthLabel — deliberately omitted
    });

    const res = await app.inject({
      method: 'GET',
      url: `/debug/sessions/${legacySession.id}`,
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { turns: Array<{ llmAuthLabel: unknown }> };
    expect(body.turns).toHaveLength(1);
    // The DTO maps undefined/null → null; must not be absent from the payload.
    expect(body.turns[0].llmAuthLabel).toBeNull();
  });

  it('session detail turns include all four valid lane labels without coercion', async () => {
    const laneLabels = ['primary', 'stg', 'backup', 'subscription'] as const;
    const multiSession = chatStore.createSession(db, { ownerId: 'alice-sub', gameId: 'g1' });
    for (let i = 0; i < laneLabels.length; i++) {
      chatStore.appendTurn(db, {
        sessionId: multiSession.id,
        turnIndex: i,
        role: 'assistant',
        assistantText: `response from ${laneLabels[i]}`,
        llmAuthLabel: laneLabels[i],
        startedAt: Date.now() + i,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/debug/sessions/${multiSession.id}`,
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { turns: Array<{ llmAuthLabel: string | null }> };
    const returnedLabels = body.turns.map((t) => t.llmAuthLabel);
    expect(returnedLabels).toEqual([...laneLabels]);
  });
});
