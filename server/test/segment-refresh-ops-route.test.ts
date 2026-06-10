/**
 * segment-refresh-ops routes (real-auth): admin gating on GET /ops, and the
 * unstick override (404 unknown id, 200 + status flip on a refreshing row,
 * idempotent no-op on a non-refreshing row).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
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

function seedRefreshing(id: string): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO segments (id, name, type, owner, status, cube, predicate_tree_json,
      cube_query_json, uid_count, uid_list_json, refresh_cadence_min, last_refreshed_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, `seg ${id}`, 'predicate', 'tester', 'refreshing', 'mf_users', '{}',
    '{"filters":[]}', 0, '[]', 60, null, now, now);
}

describe('segment-refresh-ops routes (real-auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  let adminAuth: { authorization: string };
  let editorAuth: { authorization: string };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    adminAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'a', username: 'admin', email: 'admin@corp.com', role: 'admin' })}` };
    editorAuth = { authorization: `Bearer ${await signAppJwt({ sub: 'e', username: 'editor', email: 'editor@corp.com', role: 'editor' })}` };
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('GET /ops → 401 anon, 403 non-admin, 200 admin', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/segment-refresh/ops' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/segment-refresh/ops', headers: editorAuth })).statusCode).toBe(403);

    const ok = await app.inject({ method: 'GET', url: '/api/segment-refresh/ops', headers: adminAuth });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body).toHaveProperty('cron');
    expect(body).toHaveProperty('queue');
    expect(body).toHaveProperty('summary');
    expect(Array.isArray(body.segments)).toBe(true);
  });

  it('POST /:id/unstick → 404 for an unknown segment', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/segment-refresh/nope/unstick', headers: adminAuth });
    expect(res.statusCode).toBe(404);
  });

  it('POST /:id/unstick flips a refreshing row to stale, idempotent afterward', async () => {
    seedRefreshing('stuck');

    const first = await app.inject({ method: 'POST', url: '/api/segment-refresh/stuck/unstick', headers: adminAuth });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ id: 'stuck', unstuck: true, status: 'stale' });

    // Second call is a no-op (already stale) but still 200.
    const second = await app.inject({ method: 'POST', url: '/api/segment-refresh/stuck/unstick', headers: adminAuth });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: 'stuck', unstuck: false, status: 'stale' });
  });
});
