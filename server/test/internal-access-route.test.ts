/**
 * Phase 5 — internal access endpoint feeding cube-dev's checkAuth.
 * Shared-secret gated; returns role+games for active users; 404 (fail-closed)
 * for unknown/inactive; 401 on bad secret; 503 when secret unset.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess, setGames } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const SECRET = 'internal-shared-secret';

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('GET /internal/access/:key', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = process.env.CUBE_AUTH_INTERNAL_SECRET;

  beforeEach(async () => {
    process.env.CUBE_AUTH_INTERNAL_SECRET = SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'user@corp.com', role: 'editor', status: 'active' });
    setGames('user@corp.com', ['ballistar', 'cfm_vn']);
    upsertUserAccess({ email: 'pending@corp.com', role: 'viewer', status: 'pending' });
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.CUBE_AUTH_INTERNAL_SECRET = prev;
  });

  const hdr = { 'x-internal-secret': SECRET };

  it('returns role + games for active user', async () => {
    const res = await app.inject({ method: 'GET', url: '/internal/access/User@Corp.com', headers: hdr });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe('editor');
    expect((body.allowedGames as string[]).sort()).toEqual(['ballistar', 'cfm_vn']);
  });

  it('404 (fail-closed) for pending/unknown', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/access/pending@corp.com', headers: hdr })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/internal/access/nobody@corp.com', headers: hdr })).statusCode).toBe(404);
  });

  it('401 on missing/wrong secret', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/access/user@corp.com' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/internal/access/user@corp.com', headers: { 'x-internal-secret': 'nope' } })).statusCode,
    ).toBe(401);
  });

  it('503 when secret unset', async () => {
    delete process.env.CUBE_AUTH_INTERNAL_SECRET;
    const res = await app.inject({ method: 'GET', url: '/internal/access/user@corp.com', headers: hdr });
    expect(res.statusCode).toBe(503);
  });
});
