/**
 * announcements read-state routes — per-user receipts for the What's New inbox.
 * Real-auth mode so `req.owner` resolves to the JWT sub (not the dev synth-admin),
 * which lets us prove cross-owner isolation: one user's marks never leak to another.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('announcements read-state routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let aliceAuth: { authorization: string };
  let bobAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'alice@corp.com', role: 'editor', status: 'active' });
    upsertUserAccess({ email: 'bob@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    aliceAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'alice-sub', username: 'alice', email: 'alice@corp.com', role: 'editor' })}` };
    bobAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'bob-sub', username: 'bob', email: 'bob@corp.com', role: 'editor' })}` };
  });

  afterEach(async () => {
    await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('returns an empty read list for a fresh user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/announcements/reads', headers: aliceAuth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ readIds: [] });
  });

  it('marks ids read and lists them back for the same user', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/announcements/reads',
      headers: aliceAuth,
      payload: { ids: ['feat-a', 'feat-b'] },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json().readIds.sort()).toEqual(['feat-a', 'feat-b']);

    const get = await app.inject({ method: 'GET', url: '/api/announcements/reads', headers: aliceAuth });
    expect(get.json().readIds.sort()).toEqual(['feat-a', 'feat-b']);
  });

  it('isolates read-state per owner', async () => {
    await app.inject({ method: 'POST', url: '/api/announcements/reads', headers: aliceAuth, payload: { ids: ['feat-a'] } });
    const bob = await app.inject({ method: 'GET', url: '/api/announcements/reads', headers: bobAuth });
    expect(bob.json()).toEqual({ readIds: [] });
  });

  it('is idempotent — re-marking the same id does not error or duplicate', async () => {
    await app.inject({ method: 'POST', url: '/api/announcements/reads', headers: aliceAuth, payload: { ids: ['feat-a'] } });
    const again = await app.inject({ method: 'POST', url: '/api/announcements/reads', headers: aliceAuth, payload: { ids: ['feat-a', 'feat-c'] } });
    expect(again.statusCode).toBe(200);
    expect(again.json().readIds.sort()).toEqual(['feat-a', 'feat-c']);
  });

  it('rejects a malformed payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/announcements/reads',
      headers: aliceAuth,
      payload: { ids: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });
});
