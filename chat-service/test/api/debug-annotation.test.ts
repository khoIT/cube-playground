/**
 * Integration tests for POST/DELETE /debug/turns/:turnId/annotation.
 *
 * Covers: happy path upsert, merge update, delete, 401/403/404 guards,
 * cross-owner isolation (403), flag validation.
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

import debugAnnotationRoutes from '../../src/api/debug-annotations.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function seedTurn(db: Database.Database, ownerId = 'owner-a', gameId = 'g1') {
  const session = chatStore.createSession(db, { ownerId, gameId, title: 'test' });
  const turnId = 'turn-' + Math.random().toString(36).slice(2);
  db.prepare(
    `INSERT INTO chat_turns (id, session_id, turn_index, role, started_at) VALUES (?, ?, 0, 'assistant', ?)`,
  ).run(turnId, session.id, Date.now());
  return { session, turnId };
}

async function buildApp(db: Database.Database) {
  const fastify = Fastify({ logger: false });
  await fastify.register(debugAnnotationRoutes, { db });
  await fastify.ready();
  return fastify;
}

describe('POST /debug/turns/:turnId/annotation', () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });

  it('returns 401 without X-Owner-Id', async () => {
    const app = await buildApp(db);
    const res = await app.inject({ method: 'POST', url: '/debug/turns/x/annotation', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for non-existent turn', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'POST', url: '/debug/turns/no-such-turn/annotation',
      headers: { 'x-owner-id': 'owner-a' }, payload: { starred: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when caller is not the turn owner', async () => {
    const app = await buildApp(db);
    const { turnId } = seedTurn(db, 'owner-a');
    const res = await app.inject({
      method: 'POST', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-b' }, payload: { starred: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates annotation with starred=true', async () => {
    const app = await buildApp(db);
    const { turnId } = seedTurn(db, 'owner-a');
    const res = await app.inject({
      method: 'POST', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-a' }, payload: { starred: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.starred).toBe(true);
    expect(body.turnId).toBe(turnId);
  });

  it('merges update: only changes fields explicitly provided', async () => {
    const app = await buildApp(db);
    const { turnId } = seedTurn(db, 'owner-a');
    await app.inject({
      method: 'POST', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-a' }, payload: { starred: true, flag: 'bug' },
    });
    const res = await app.inject({
      method: 'POST', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-a' }, payload: { note: 'look at this' },
    });
    const body = res.json();
    expect(body.starred).toBe(true);
    expect(body.flag).toBe('bug');
    expect(body.note).toBe('look at this');
  });

  it('returns 400 for invalid flag value', async () => {
    const app = await buildApp(db);
    const { turnId } = seedTurn(db, 'owner-a');
    const res = await app.inject({
      method: 'POST', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-a' }, payload: { flag: 'invalid-value' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts all valid flag values', async () => {
    const app = await buildApp(db);
    for (const flag of ['bug', 'important', 'review', null]) {
      const { turnId } = seedTurn(db);
      const res = await app.inject({
        method: 'POST', url: `/debug/turns/${turnId}/annotation`,
        headers: { 'x-owner-id': 'owner-a' }, payload: { flag },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('cross-owner: owner-b cannot read owner-a annotation via upsert', async () => {
    const app = await buildApp(db);
    const { turnId } = seedTurn(db, 'owner-a');
    await app.inject({
      method: 'POST', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-a' }, payload: { starred: true },
    });
    // owner-b tries to upsert — must 403
    const res = await app.inject({
      method: 'POST', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-b' }, payload: { starred: false },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /debug/turns/:turnId/annotation', () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });

  it('returns 401 without X-Owner-Id', async () => {
    const app = await buildApp(db);
    const res = await app.inject({ method: 'DELETE', url: '/debug/turns/x/annotation' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for cross-owner delete attempt', async () => {
    const app = await buildApp(db);
    const { turnId } = seedTurn(db, 'owner-a');
    const res = await app.inject({
      method: 'DELETE', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-b' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deletes annotation and returns 204', async () => {
    const app = await buildApp(db);
    const { turnId } = seedTurn(db, 'owner-a');
    await app.inject({
      method: 'POST', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-a' }, payload: { starred: true },
    });
    const del = await app.inject({
      method: 'DELETE', url: `/debug/turns/${turnId}/annotation`,
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(del.statusCode).toBe(204);

    // Verify row is gone
    const row = db.prepare('SELECT * FROM turn_annotations WHERE turn_id = ?').get(turnId);
    expect(row).toBeUndefined();
  });

  it('no-op delete on non-existent annotation returns 404 (turn must exist for owner check)', async () => {
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'DELETE', url: '/debug/turns/no-turn/annotation',
      headers: { 'x-owner-id': 'owner-a' },
    });
    expect(res.statusCode).toBe(404);
  });
});
