/**
 * /api/user-prefs (per-owner kv) and /api/cube-aliases (per-owner+workspace)
 * route integration tests — the DB-backed replacements for the former
 * localStorage artifact storage.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

import { setDb, closeDb } from '../src/db/sqlite.js';
import ownerHeader from '../src/middleware/owner-header.js';
import workspaceHeader from '../src/middleware/workspace-header.js';
import userPrefsRoutes from '../src/routes/user-prefs.js';
import cubeAliasesRoutes from '../src/routes/cube-aliases.js';

function inMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_prefs (
      owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY (owner, key)
    );
    CREATE TABLE cube_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL, workspace TEXT NOT NULL, cube_name TEXT NOT NULL,
      alias TEXT, icon TEXT, updated_at TEXT NOT NULL,
      UNIQUE(owner, workspace, cube_name)
    );
  `);
  return db;
}

let app: FastifyInstance;

beforeEach(async () => {
  closeDb();
  setDb(inMemoryDb());
  app = Fastify();
  await app.register(ownerHeader);
  await app.register(workspaceHeader);
  await app.register(userPrefsRoutes);
  await app.register(cubeAliasesRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeDb();
});

describe('/api/user-prefs', () => {
  it('round-trips a value scoped to the owner', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/user-prefs/workspace',
      headers: { 'x-owner': 'alice' },
      payload: { value: 'prod' },
    });
    const got = await app.inject({
      method: 'GET',
      url: '/api/user-prefs/workspace',
      headers: { 'x-owner': 'alice' },
    });
    expect(got.json()).toEqual({ value: 'prod' });

    // A different owner sees nothing — per-owner isolation.
    const other = await app.inject({
      method: 'GET',
      url: '/api/user-prefs/workspace',
      headers: { 'x-owner': 'bob' },
    });
    expect(other.json()).toEqual({ value: null });
  });

  it('accepts a large draft blob (> old 2048 cap)', async () => {
    const big = JSON.stringify({ tree: 'x'.repeat(50_000) });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/user-prefs/new-metric-draft%3Atab1',
      headers: { 'x-owner': 'alice' },
      payload: { value: big },
    });
    expect(res.statusCode).toBe(204);
  });

  it('DELETE removes a pref', async () => {
    await app.inject({
      method: 'PUT', url: '/api/user-prefs/k', headers: { 'x-owner': 'alice' },
      payload: { value: 'v' },
    });
    const del = await app.inject({
      method: 'DELETE', url: '/api/user-prefs/k', headers: { 'x-owner': 'alice' },
    });
    expect(del.statusCode).toBe(204);
    const got = await app.inject({
      method: 'GET', url: '/api/user-prefs/k', headers: { 'x-owner': 'alice' },
    });
    expect(got.json()).toEqual({ value: null });
  });
});

describe('/api/cube-aliases', () => {
  const hdr = (owner: string, ws: string) => ({ 'x-owner': owner, 'x-cube-workspace': ws });

  it('isolates aliases per (owner, workspace)', async () => {
    await app.inject({
      method: 'PUT', url: '/api/cube-aliases/active_daily',
      headers: hdr('alice', 'local'), payload: { alias: 'Daily', icon: 'Users' },
    });

    // Same owner, different workspace → not visible.
    const prod = await app.inject({
      method: 'GET', url: '/api/cube-aliases', headers: hdr('alice', 'prod'),
    });
    expect(prod.json()).toEqual([]);

    const local = await app.inject({
      method: 'GET', url: '/api/cube-aliases', headers: hdr('alice', 'local'),
    });
    expect(local.json()).toEqual([
      { cube_name: 'active_daily', alias: 'Daily', icon: 'Users' },
    ]);
  });

  it('clearing both alias + icon deletes the row', async () => {
    await app.inject({
      method: 'PUT', url: '/api/cube-aliases/c',
      headers: hdr('alice', 'local'), payload: { alias: 'X' },
    });
    const clear = await app.inject({
      method: 'PUT', url: '/api/cube-aliases/c',
      headers: hdr('alice', 'local'), payload: { alias: '', icon: '' },
    });
    expect(clear.statusCode).toBe(204);
    const list = await app.inject({
      method: 'GET', url: '/api/cube-aliases', headers: hdr('alice', 'local'),
    });
    expect(list.json()).toEqual([]);
  });
});
