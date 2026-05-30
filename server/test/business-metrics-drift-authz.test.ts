/**
 * Authz: the Drift Center mutations inherit the global enforce-write-roles gate
 * (no per-route checks). A viewer must get 403 on repoint and applicability.
 */
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
import { upsertUserAccess, setGames } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
function makeMemDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}
const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';

describe('Drift Center authz (write-roles gate)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    __resetWorkspacesConfigCache();
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'viewer@corp.com', role: 'viewer', status: 'active' });
    setGames('viewer@corp.com', ['ballistar']);
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    setGames('editor@corp.com', ['ballistar']); // NOT granted 'ptg'
    app = await buildApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
    __resetWorkspacesConfigCache();
  });

  it('viewer cannot PATCH repoint', async () => {
    const token = await signAppJwt({ sub: 'v', username: 'viewer', email: 'viewer@corp.com', role: 'viewer' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/repoint',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'a.b', to: 'c.d', game: 'ballistar' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('WRITE_FORBIDDEN');
  });

  it('viewer cannot PATCH applicability', async () => {
    const token = await signAppJwt({ sub: 'v', username: 'viewer', email: 'viewer@corp.com', role: 'viewer' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/applicability',
      headers: { authorization: `Bearer ${token}` },
      payload: { game: 'ballistar', applicable: false },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('WRITE_FORBIDDEN');
  });

  it('editor without the game grant is 403 GAME_FORBIDDEN on repoint (body game)', async () => {
    const token = await signAppJwt({ sub: 'e', username: 'editor', email: 'editor@corp.com', role: 'editor' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/repoint',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'a.b', to: 'c.d', game: 'ptg' }, // editor lacks 'ptg'
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('GAME_FORBIDDEN');
  });
});
