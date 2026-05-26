/**
 * Route integration tests for Phase 03's session-focus inspection + reset
 * endpoint. Covers:
 *   - owner / session checks (401 / 404 / 403)
 *   - GET returns the focus bag stored via mergeFocus + sdk-resume flag
 *   - DELETE atomically clears focus + sdk_conversation_id + disambig slots
 *   - DELETE remains a no-op when nothing was set (idempotent 204)
 *
 * Uses an in-memory SQLite database with all chat-service migrations applied.
 * Feature flags are set on the imported `config` singleton so the focus +
 * disambig adapters take their real code paths instead of the flag-off no-op
 * (which is what runs in default test envs).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { migrate } from '../../src/db/migrate.js';
import * as chatStore from '../../src/db/chat-store.js';
import { mergeFocus, getFocus } from '../../src/cache/session-focus-adapter.js';
import { mergeResolution } from '../../src/cache/disambig-memory-adapter.js';
import { kvGet } from '../../src/cache/kv-cache-store.js';
import chatSessionFocusRoutes from '../../src/api/chat-session-focus.js';
import { config } from '../../src/config.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildApp(db: Database.Database): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(chatSessionFocusRoutes, { db });
  await f.ready();
  return f;
}

describe('chat-session-focus routes', () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let restoreFocus: () => void;
  let restoreCache: () => void;

  beforeEach(async () => {
    // Force the focus / cache adapters out of their flag-off no-ops so the
    // tests actually exercise the storage path.
    const focusBefore = config.chatContextFocusStoreEnabled;
    const cacheBefore = config.cacheServiceEnabled;
    config.chatContextFocusStoreEnabled = true;
    config.cacheServiceEnabled = true;
    restoreFocus = () => { config.chatContextFocusStoreEnabled = focusBefore; };
    restoreCache = () => { config.cacheServiceEnabled = cacheBefore; };
    db = makeDb();
    app = await buildApp(db);
  });
  afterEach(async () => {
    await app.close();
    restoreFocus();
    restoreCache();
  });

  it('GET requires X-Owner-Id', async () => {
    const session = chatStore.createSession(db, { ownerId: 'o1', gameId: 'g' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat/sessions/${session.id}/focus`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET 404s on unknown session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions/missing/focus',
      headers: { 'x-owner-id': 'o1' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET 403s when the owner does not match', async () => {
    const session = chatStore.createSession(db, { ownerId: 'o1', gameId: 'g' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat/sessions/${session.id}/focus`,
      headers: { 'x-owner-id': 'o2' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET returns the focus bag and hasSdkResume flag', async () => {
    const session = chatStore.createSession(db, { ownerId: 'o1', gameId: 'g' });
    mergeFocus(db, session.id, 'o1', {
      metric: { value: 'arpu', phrase: 'doanh thu' },
      timeRange: { value: { dateRange: 'last 7 days' } },
    });
    chatStore.setSdkConversationId(db, session.id, 'sdk-xyz');

    const res = await app.inject({
      method: 'GET',
      url: `/api/chat/sessions/${session.id}/focus`,
      headers: { 'x-owner-id': 'o1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { focus: { metric?: { value: string } }; hasSdkResume: boolean };
    expect(body.hasSdkResume).toBe(true);
    expect(body.focus.metric?.value).toBe('arpu');
  });

  it('DELETE atomically clears focus + sdk_conversation_id + disambig slots', async () => {
    const session = chatStore.createSession(db, { ownerId: 'o1', gameId: 'g' });
    mergeFocus(db, session.id, 'o1', { metric: { value: 'arpu' } });
    mergeResolution(db, session.id, 'o1', { dimension: { value: 'country' } });
    chatStore.setSdkConversationId(db, session.id, 'sdk-xyz');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/chat/sessions/${session.id}/focus`,
      headers: { 'x-owner-id': 'o1' },
    });
    expect(res.statusCode).toBe(204);

    expect(getFocus(db, session.id)).toEqual({});
    expect(kvGet(db, 'disambig_resolution', `session:${session.id}`)).toBeNull();
    const after = chatStore.getSession(db, session.id);
    expect(after?.sdk_conversation_id).toBeNull();
  });

  it('DELETE is idempotent — second call still 204 with no rows to clear', async () => {
    const session = chatStore.createSession(db, { ownerId: 'o1', gameId: 'g' });
    const first = await app.inject({
      method: 'DELETE',
      url: `/api/chat/sessions/${session.id}/focus`,
      headers: { 'x-owner-id': 'o1' },
    });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({
      method: 'DELETE',
      url: `/api/chat/sessions/${session.id}/focus`,
      headers: { 'x-owner-id': 'o1' },
    });
    expect(second.statusCode).toBe(204);
  });

  it('DELETE refuses cross-owner access', async () => {
    const session = chatStore.createSession(db, { ownerId: 'o1', gameId: 'g' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/chat/sessions/${session.id}/focus`,
      headers: { 'x-owner-id': 'o2' },
    });
    expect(res.statusCode).toBe(403);
  });
});
