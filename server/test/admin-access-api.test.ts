/**
 * Phase 4 + 6 — admin access API authz + server-side game enforcement.
 *
 * Covers: non-admin 403 on every admin route, admin CRUD round-trip, audit row
 * written, last-admin guard (409), and fail-closed game enforcement at the
 * workspace-header gate (disallowed game → 403 before any proxy).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep the suite hermetic: the admin registry enumerates a prefix workspace's
// games via prod-game-registry, which would otherwise fetch the live
// cube.gds /cubes endpoint. Stub it with a fixed roster — no network.
vi.mock('../src/services/prod-game-registry.js', () => ({
  listWorkspaceGameIds: vi.fn(async (ws: { gameModel: string }) =>
    ws.gameModel === 'prefix' ? ['cfm_vn', 'jus_vn', 'ballistar', 'ptg'] : ['ptg', 'ballistar', 'cfm_vn'],
  ),
  fetchProdCubeIds: vi.fn(async () => ['cfm_vn', 'jus_vn', 'ballistar', 'ptg']),
  __resetProdGameRegistryCache: vi.fn(),
}));

import { buildApp } from '../src/index.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess, setWorkspaceGames } from '../src/auth/access-store-mutators.js';

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
    setWorkspaceGames('viewer@corp.com', 'local', ['ballistar']);
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

    // Per-workspace route: grant games for 'local' workspace.
    const games = await app.inject({
      method: 'PUT',
      url: '/api/admin/users/new.user@corp.com/workspaces/local/games',
      headers: auth,
      payload: { gameIds: ['ptg', 'cfm_vn'] },
    });
    expect(games.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    const users = list.json().users as Array<{ email: string; gamesByWorkspace: Record<string, string[]> }>;
    const created = users.find((u) => u.email === 'new.user@corp.com');
    expect(created?.gamesByWorkspace['local'].sort()).toEqual(['cfm_vn', 'ptg']);

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

  // ── per-workspace game grant admin routes ──────────────────────────────────

  it('PUT .../workspaces/local/games persists only to local, leaving other workspaces intact', async () => {
    const atok = await tok('a', 'admin@corp.com', 'admin');
    const auth = { authorization: `Bearer ${atok}` };

    // Seed a user and give them games in two workspaces.
    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth,
      payload: { email: 'multi@corp.com', role: 'editor' },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/admin/users/multi@corp.com/workspaces/local/games',
      headers: auth,
      payload: { gameIds: ['ballistar', 'cfm_vn'] },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/admin/users/multi@corp.com/workspaces/prod/games',
      headers: auth,
      payload: { gameIds: ['cfm_vn'] },
    });

    // Now replace local only.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/users/multi@corp.com/workspaces/local/games',
      headers: auth,
      payload: { gameIds: ['ptg'] },
    });
    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    const user = (list.json().users as Array<{ email: string; gamesByWorkspace: Record<string, string[]> }>)
      .find((u) => u.email === 'multi@corp.com');
    // local replaced.
    expect(user?.gamesByWorkspace['local']).toEqual(['ptg']);
    // prod untouched.
    expect(user?.gamesByWorkspace['prod']).toEqual(['cfm_vn']);
  });

  it('PUT .../workspaces/:wsId/games with unknown wsId → 400', async () => {
    const atok = await tok('a', 'admin@corp.com', 'admin');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/users/viewer@corp.com/workspaces/ghost-workspace/games',
      headers: { authorization: `Bearer ${atok}` },
      payload: { gameIds: ['ballistar'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('per-workspace games route writes an audit row with workspaceId in detail', async () => {
    const atok = await tok('a', 'admin@corp.com', 'admin');
    const before = (getDb().prepare('SELECT COUNT(*) AS n FROM access_audit').get() as { n: number }).n;
    await app.inject({
      method: 'PUT',
      url: '/api/admin/users/viewer@corp.com/workspaces/local/games',
      headers: { authorization: `Bearer ${atok}` },
      payload: { gameIds: ['ptg'] },
    });
    const rows = getDb()
      .prepare("SELECT detail_json FROM access_audit WHERE action = 'set_workspace_games' ORDER BY id DESC LIMIT 1")
      .get() as { detail_json: string } | undefined;
    expect(rows).toBeDefined();
    const detail = JSON.parse(rows!.detail_json) as { workspaceId: string; gameIds: string[] };
    expect(detail.workspaceId).toBe('local');
    expect(detail.gameIds).toEqual(['ptg']);
    // At least one new audit row was written.
    const after = (getDb().prepare('SELECT COUNT(*) AS n FROM access_audit').get() as { n: number }).n;
    expect(after).toBeGreaterThan(before);
  });
});
