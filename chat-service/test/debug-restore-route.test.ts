/**
 * Tests for POST /sessions/:id/restore and the debug alias
 * POST /debug/sessions/:id/restore.
 *
 * Covers: happy path, 403 cross-owner, 404 missing session.
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

// snapshot-store writes to disk — stub it out
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

describe('POST /sessions/:id/restore', () => {
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    db = makeDb();
    app = await buildTestApp(db);
  });

  afterAll(() => app.close());

  it('restores a soft-deleted session — 200 with cleared deletedAt', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });
    chatStore.softDeleteSession(db, session.id);

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/restore`,
      headers: { 'x-owner-id': 'owner-a' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { deleted_at: number | null };
    expect(body.deleted_at).toBeNull();

    // Session should now be visible in listSessions
    const list = chatStore.listSessions(db, { ownerId: 'owner-a', gameId: 'g1' });
    expect(list.some((s) => s.id === session.id)).toBe(true);
  });

  it('returns 401 when X-Owner-Id header is missing', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });
    chatStore.softDeleteSession(db, session.id);

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/restore`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when a different owner tries to restore', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });
    chatStore.softDeleteSession(db, session.id);

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/restore`,
      headers: { 'x-owner-id': 'owner-b' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a non-existent session id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions/nonexistent-id/restore',
      headers: { 'x-owner-id': 'owner-a' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /debug/sessions/:id', () => {
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    db = makeDb();
    app = await buildTestApp(db);
  });

  afterAll(() => app.close());

  it('hard-purges a soft-deleted session — 204 and tombstone written', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });
    chatStore.softDeleteSession(db, session.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/debug/sessions/${session.id}`,
      headers: { 'x-owner-id': 'owner-a' },
    });

    expect(res.statusCode).toBe(204);

    // Session row is gone.
    expect(chatStore.getSession(db, session.id)).toBeFalsy();

    // Tombstone was inserted so the snapshot path drops the row downstream.
    const tomb = db
      .prepare('SELECT session_id FROM chat_tombstones WHERE session_id = ?')
      .get(session.id) as { session_id: string } | undefined;
    expect(tomb?.session_id).toBe(session.id);
  });

  it('returns 409 when the session is still live (not soft-deleted)', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/debug/sessions/${session.id}`,
      headers: { 'x-owner-id': 'owner-a' },
    });

    expect(res.statusCode).toBe(409);
    expect(chatStore.getSession(db, session.id)).toBeDefined();
  });

  it('returns 401 when X-Owner-Id is missing', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });
    chatStore.softDeleteSession(db, session.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/debug/sessions/${session.id}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when a different owner tries to purge', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });
    chatStore.softDeleteSession(db, session.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/debug/sessions/${session.id}`,
      headers: { 'x-owner-id': 'owner-b' },
    });

    expect(res.statusCode).toBe(403);
    expect(chatStore.getSession(db, session.id)).toBeDefined();
  });

  it('returns 404 for a non-existent session id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/debug/sessions/does-not-exist',
      headers: { 'x-owner-id': 'owner-a' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /debug/sessions/:id/restore', () => {
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    db = makeDb();
    app = await buildTestApp(db);
  });

  afterAll(() => app.close());

  it('restores via the debug alias — 200', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });
    chatStore.softDeleteSession(db, session.id);

    const res = await app.inject({
      method: 'POST',
      url: `/debug/sessions/${session.id}/restore`,
      headers: { 'x-owner-id': 'owner-a' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { deletedAt: number | null };
    expect(body.deletedAt).toBeNull();
  });

  it('403 cross-owner via debug alias', async () => {
    const session = chatStore.createSession(db, { ownerId: 'owner-a', gameId: 'g1' });
    chatStore.softDeleteSession(db, session.id);

    const res = await app.inject({
      method: 'POST',
      url: `/debug/sessions/${session.id}/restore`,
      headers: { 'x-owner-id': 'evil-owner' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('404 for missing session via debug alias', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/debug/sessions/does-not-exist/restore',
      headers: { 'x-owner-id': 'owner-a' },
    });

    expect(res.statusCode).toBe(404);
  });
});
