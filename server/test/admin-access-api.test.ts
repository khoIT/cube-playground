/**
 * Phase 4 + 6 — admin access API authz + server-side game enforcement.
 *
 * Covers: non-admin 403 on every admin route, admin CRUD round-trip, audit row
 * written, last-admin guard (409), and fail-closed game enforcement at the
 * workspace-header gate (disallowed game → 403 before any proxy).
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
import { upsertUserAccess, setGames } from '../src/auth/access-store-mutators.js';

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

const tok = (sub: string, email: string, role: 'viewer' | 'editor' | 'admin') =>
  signAppJwt({ sub, username: sub, email, role });

describe('admin access API + game gate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
    upsertUserAccess({ email: 'viewer@corp.com', role: 'viewer', status: 'active' });
    setGames('viewer@corp.com', ['ballistar']);
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
  });

  it('non-admin gets 403 on admin routes; no token 401', async () => {
    const vtok = await tok('v', 'viewer@corp.com', 'viewer');
    for (const url of ['/api/admin/users', '/api/admin/registry']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${vtok}` } });
      expect(res.statusCode).toBe(403);
    }
    const noAuth = await app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(noAuth.statusCode).toBe(401);
  });

  it('admin round-trips create → grants → list, and writes audit rows', async () => {
    const atok = await tok('a', 'admin@corp.com', 'admin');
    const auth = { authorization: `Bearer ${atok}` };

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth,
      payload: { email: 'New.User@Corp.com', role: 'editor' },
    });
    expect(create.statusCode).toBe(201);

    const games = await app.inject({
      method: 'PUT',
      url: '/api/admin/users/new.user@corp.com/games',
      headers: auth,
      payload: { gameIds: ['ptg', 'cfm_vn'] },
    });
    expect(games.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    const users = list.json().users as Array<{ email: string; games: string[] }>;
    const created = users.find((u) => u.email === 'new.user@corp.com');
    expect(created?.games.sort()).toEqual(['cfm_vn', 'ptg']);

    const auditCount = getDb()
      .prepare('SELECT COUNT(*) AS n FROM access_audit')
      .get() as { n: number };
    expect(auditCount.n).toBeGreaterThanOrEqual(2);
  });

  it('registry returns workspaces, games, featureKeys', async () => {
    const atok = await tok('a', 'admin@corp.com', 'admin');
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/registry',
      headers: { authorization: `Bearer ${atok}` },
    });
    const body = res.json();
    expect(Array.isArray(body.workspaces)).toBe(true);
    expect(body.featureKeys).toContain('admin');
  });

  it('guards the last active admin (409) on PATCH', async () => {
    const atok = await tok('a', 'admin@corp.com', 'admin');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/admin@corp.com',
      headers: { authorization: `Bearer ${atok}` },
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('guards the last active admin (409) on POST/upsert too', async () => {
    const atok = await tok('a', 'admin@corp.com', 'admin');
    const auth = { authorization: `Bearer ${atok}` };
    // demote the last admin via the pre-provision path
    const demote = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth,
      payload: { email: 'admin@corp.com', role: 'viewer' },
    });
    expect(demote.statusCode).toBe(409);
    // disable the last admin via the pre-provision path
    const disable = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth,
      payload: { email: 'admin@corp.com', status: 'disabled' },
    });
    expect(disable.statusCode).toBe(409);
    // sanity: admin is untouched
    const list = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    const admin = (list.json().users as Array<{ email: string; role: string; status: string }>).find(
      (u) => u.email === 'admin@corp.com',
    );
    expect(admin?.role).toBe('admin');
    expect(admin?.status).toBe('active');
  });

  it('fails closed on a disallowed game (GAME_FORBIDDEN)', async () => {
    const vtok = await tok('v', 'viewer@corp.com', 'viewer');
    // viewer is granted ballistar only → ptg must 403 at the gate.
    const denied = await app.inject({
      method: 'GET',
      url: '/api/segments?owner=*',
      headers: { authorization: `Bearer ${vtok}`, 'x-cube-game': 'ptg' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error?.code).toBe('GAME_FORBIDDEN');
    // granted game passes the gate.
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/segments?owner=*',
      headers: { authorization: `Bearer ${vtok}`, 'x-cube-game': 'ballistar' },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
