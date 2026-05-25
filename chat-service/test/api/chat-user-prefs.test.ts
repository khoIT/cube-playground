/**
 * Route integration tests for the Settings "Remembered defaults" backend.
 *
 * Uses an in-memory SQLite database with the user_disambig_prefs migration
 * applied, plus a stand-alone Fastify instance with only the prefs plugin
 * registered. No cube /meta token is supplied — the label resolver falls
 * back to the raw member ref in that case, which is fine for these tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { migrate } from '../../src/db/migrate.js';
import { upsertUserPref } from '../../src/cache/user-prefs-adapter.js';
import chatUserPrefsRoutes from '../../src/api/chat-user-prefs.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

async function buildApp(db: Database.Database): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  await f.register(chatUserPrefsRoutes, { db });
  await f.ready();
  return f;
}

describe('chat-user-prefs routes', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = makeDb();
    app = await buildApp(db);
  });
  afterEach(async () => { await app.close(); });

  it('GET requires X-Owner-Id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chat/user-prefs?gameId=g' });
    expect(res.statusCode).toBe(401);
  });

  it('GET requires gameId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/user-prefs',
      headers: { 'x-owner-id': 'o1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET returns empty list when no prefs exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/user-prefs?gameId=g',
      headers: { 'x-owner-id': 'o1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('GET lists rows with falls-back-to-raw labels when no cube token', async () => {
    upsertUserPref(db, { ownerId: 'o1', gameId: 'g', slot: 'metric', value: 'recharge.arpdau', now: 100 });
    upsertUserPref(db, {
      ownerId: 'o1', gameId: 'g', slot: 'timeRange',
      value: { dateRange: 'this month', granularity: 'day' },
      phrase: 'this month', now: 200,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/user-prefs?gameId=g',
      headers: { 'x-owner-id': 'o1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ slot: string; label: string }> };
    expect(body.items).toHaveLength(2);
    // last_used_at DESC → timeRange first.
    expect(body.items[0].slot).toBe('timeRange');
    expect(body.items[0].label).toBe('this month');
    expect(body.items[1].slot).toBe('metric');
    expect(body.items[1].label).toBe('recharge.arpdau');
  });

  it('GET is isolated per owner', async () => {
    upsertUserPref(db, { ownerId: 'o1', gameId: 'g', slot: 'metric', value: 'arpu' });
    upsertUserPref(db, { ownerId: 'o2', gameId: 'g', slot: 'metric', value: 'arpdau' });

    const r1 = await app.inject({
      method: 'GET', url: '/api/chat/user-prefs?gameId=g',
      headers: { 'x-owner-id': 'o1' },
    });
    expect((r1.json() as { items: Array<{ value: string }> }).items[0].value).toBe('arpu');
  });

  it('DELETE :slot drops a single row', async () => {
    upsertUserPref(db, { ownerId: 'o1', gameId: 'g', slot: 'metric', value: 'arpu' });
    upsertUserPref(db, { ownerId: 'o1', gameId: 'g', slot: 'dimension', value: 'country' });

    const del = await app.inject({
      method: 'DELETE', url: '/api/chat/user-prefs/metric?gameId=g',
      headers: { 'x-owner-id': 'o1' },
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET', url: '/api/chat/user-prefs?gameId=g',
      headers: { 'x-owner-id': 'o1' },
    });
    const items = (list.json() as { items: Array<{ slot: string }> }).items;
    expect(items.map((i) => i.slot)).toEqual(['dimension']);
  });

  it('DELETE :slot 404s when row missing', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/api/chat/user-prefs/metric?gameId=g',
      headers: { 'x-owner-id': 'o1' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE :slot URL-decodes filter:member keys', async () => {
    upsertUserPref(db, {
      ownerId: 'o1', gameId: 'g', slot: 'filter:players.channel', value: 'web',
    });
    const encoded = encodeURIComponent('filter:players.channel');
    const del = await app.inject({
      method: 'DELETE', url: `/api/chat/user-prefs/${encoded}?gameId=g`,
      headers: { 'x-owner-id': 'o1' },
    });
    expect(del.statusCode).toBe(204);
  });

  it('DELETE root clears every row for owner+game', async () => {
    upsertUserPref(db, { ownerId: 'o1', gameId: 'g', slot: 'metric', value: 'arpu' });
    upsertUserPref(db, { ownerId: 'o1', gameId: 'g', slot: 'dimension', value: 'country' });
    upsertUserPref(db, { ownerId: 'o1', gameId: 'other', slot: 'metric', value: 'arpdau' });

    const del = await app.inject({
      method: 'DELETE', url: '/api/chat/user-prefs?gameId=g',
      headers: { 'x-owner-id': 'o1' },
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET', url: '/api/chat/user-prefs?gameId=g',
      headers: { 'x-owner-id': 'o1' },
    });
    expect((list.json() as { items: unknown[] }).items).toHaveLength(0);

    const other = await app.inject({
      method: 'GET', url: '/api/chat/user-prefs?gameId=other',
      headers: { 'x-owner-id': 'o1' },
    });
    expect((other.json() as { items: unknown[] }).items).toHaveLength(1);
  });
});
