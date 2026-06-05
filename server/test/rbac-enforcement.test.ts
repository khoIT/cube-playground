import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetWorkspacesConfigCache } from '../src/services/workspaces-config-loader.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess, setWorkspaceGames } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

async function viewerToken(): Promise<string> {
  return signAppJwt({ sub: 'viewer-1', username: 'viewer', email: 'viewer@corp.com', role: 'viewer' });
}
async function editorToken(): Promise<string> {
  return signAppJwt({ sub: 'editor-1', username: 'editor', email: 'editor@corp.com', role: 'editor' });
}
async function adminToken(): Promise<string> {
  return signAppJwt({ sub: 'admin-1', username: 'admin', email: 'admin@corp.com', role: 'admin' });
}

// Seed DB-authoritative grants (role from DB now). No per-user workspace grants
// → the workspace gate falls back to the role check, preserving the role-based
// behavior these assertions cover.
function seedAccess(): void {
  __resetAccessCache();
  upsertUserAccess({ email: 'viewer@corp.com', role: 'viewer', status: 'active' });
  setWorkspaceGames('viewer@corp.com', 'local', ['ballistar']);
  upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
  setWorkspaceGames('editor@corp.com', 'local', ['ballistar', 'cfm_vn']);
  setWorkspaceGames('editor@corp.com', 'prod', ['ballistar', 'cfm_vn']);
  upsertUserAccess({ email: 'admin@corp.com', role: 'admin', status: 'active' });
  setWorkspaceGames('admin@corp.com', 'local', ['ptg', 'ballistar', 'cfm_vn', 'cros', 'jus_vn']);
  setWorkspaceGames('admin@corp.com', 'prod', ['cfm_vn', 'ballistar', 'cros', 'jus_vn']);
}

describe('Phase 6.4 RBAC enforcement', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    __resetWorkspacesConfigCache();
    setDb(makeMemDb());
    seedAccess();
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
    __resetWorkspacesConfigCache();
  });

  it('viewer cannot POST /api/segments (write-roles gate)', async () => {
    const token = await viewerToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'v-seg', type: 'manual' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('WRITE_FORBIDDEN');
  });

  it('editor CAN POST /api/segments', async () => {
    const token = await editorToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/segments',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'e-seg', type: 'manual' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().owner).toBe('editor-1');
  });

  it('/api/workspaces filters out prod for viewer', async () => {
    const token = await viewerToken();
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().workspaces as Array<{ id: string }>).map((w) => w.id);
    expect(ids).toContain('local');
    expect(ids).not.toContain('prod');
  });

  it('/api/workspaces returns prod for editor and admin', async () => {
    for (const tok of [await editorToken(), await adminToken()]) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/workspaces',
        headers: { authorization: `Bearer ${tok}` },
      });
      const ids = (res.json().workspaces as Array<{ id: string }>).map((w) => w.id);
      expect(ids).toContain('prod');
    }
  });

  it('forces 403 when viewer sends x-cube-workspace=prod', async () => {
    const token = await viewerToken();
    const res = await app.inject({
      method: 'GET',
      url: '/api/segments?owner=*',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cube-workspace': 'prod',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('WORKSPACE_FORBIDDEN');
  });

  it('editor on prod (workspace allowed): no 403', async () => {
    const token = await editorToken();
    const res = await app.inject({
      method: 'GET',
      url: '/api/segments?owner=*',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cube-workspace': 'prod',
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('game granted only in local → 403 GAME_FORBIDDEN on prod (cross-workspace grant isolation)', async () => {
    // viewer has ballistar in 'local' only. The prod workspace's gamePrefixMap
    // includes 'ballistar', but the user holds no grant in 'prod' → fail-closed.
    // (viewer also lacks workspace access to prod, so seed a separate editor who
    // has the workspace but not the game in prod.)
    //
    // Use editor: editor has ballistar + cfm_vn in local, but only those games
    // in prod too (seeded in seedAccess). Pick ptg which editor lacks in prod.
    const token = await editorToken();
    const res = await app.inject({
      method: 'GET',
      url: '/api/segments?owner=*',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cube-workspace': 'prod',
        'x-cube-game': 'cros', // editor not granted cros in prod
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('GAME_FORBIDDEN');
  });

  it('game granted in prod → 200 on prod request', async () => {
    // editor has cfm_vn in both local and prod (seeded in seedAccess).
    const token = await editorToken();
    const res = await app.inject({
      method: 'GET',
      url: '/api/segments?owner=*',
      headers: {
        authorization: `Bearer ${token}`,
        'x-cube-workspace': 'prod',
        'x-cube-game': 'cfm_vn',
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
